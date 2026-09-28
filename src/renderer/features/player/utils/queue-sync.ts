import { QueryClient } from '@tanstack/react-query';
import { t } from 'i18next';

import { api } from '/@/renderer/api';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    formatQueueSyncClientName,
    parseQueueSyncClientName,
    resolveQueueSyncDeviceName,
} from '/@/renderer/features/player/utils/queue-sync-device';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { usePlayerStore, useSettingsStore, useTimestampStoreBase } from '/@/renderer/store';
import { GetQueueResponse } from '/@/shared/types/domain-types';

const QUEUE_SAVE_SUPPRESSION_AFTER_RESTORE_MS = 3000;

let queueSavesSuppressedUntilMs = 0;

const knownQueueSignatureStorageKey = (serverId: string) => `queue-sync-signature:${serverId}`;
const dismissedSessionStorageKey = (serverId: string) => `queue-sync-dismissed:${serverId}`;

const hashString = (value: string) => {
    let hash = 0x811c9dc5;

    for (let charIndex = 0; charIndex < value.length; charIndex++) {
        hash ^= value.charCodeAt(charIndex);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(36);
};

const readStorageValue = (key: string) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeStorageValue = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        return;
    }
};

export const getQueueSignature = (songIds: string[], currentIndex: number, positionMs: number) =>
    `${currentIndex}:${Math.round(positionMs)}:${hashString(songIds.join(','))}`;

export const getServerQueueSignature = (queue: GetQueueResponse) =>
    getQueueSignature(
        queue.entry.map((song) => song.id),
        queue.currentIndex,
        queue.positionMs,
    );

const getServerQueueSessionKey = (queue: GetQueueResponse) => {
    const { deviceId, deviceName } = parseQueueSyncClientName(queue.changedBy);
    return `${deviceId ?? deviceName}:${hashString(queue.entry.map((song) => song.id).join(','))}`;
};

export const writeKnownQueueSignature = (serverId: string, signature: string) =>
    writeStorageValue(knownQueueSignatureStorageKey(serverId), signature);

export const isServerQueueFromOtherDevice = (serverId: string, queue: GetQueueResponse) => {
    if (queue.entry.length === 0) return false;
    if (parseQueueSyncClientName(queue.changedBy).isThisDevice) return false;

    return (
        getServerQueueSignature(queue) !== readStorageValue(knownQueueSignatureStorageKey(serverId))
    );
};

export const dismissServerQueueSession = (serverId: string, queue: GetQueueResponse) =>
    writeStorageValue(dismissedSessionStorageKey(serverId), getServerQueueSessionKey(queue));

export const isServerQueueSessionDismissed = (serverId: string, queue: GetQueueResponse) =>
    readStorageValue(dismissedSessionStorageKey(serverId)) === getServerQueueSessionKey(queue);

export const getThisDeviceClientName = () =>
    formatQueueSyncClientName(
        resolveQueueSyncDeviceName(useSettingsStore.getState().queueSync.deviceName),
    );

export const getThisDeviceClientNameIfSyncEnabled = () =>
    useSettingsStore.getState().queueSync.enabled ? getThisDeviceClientName() : undefined;

export const suppressQueueSaves = (durationMs: number) => {
    queueSavesSuppressedUntilMs = Math.max(queueSavesSuppressedUntilMs, Date.now() + durationMs);
};

export const areQueueSavesSuppressed = () => Date.now() < queueSavesSuppressedUntilMs;

export const saveQueueSnapshotToServer = async (
    serverId: string,
    snapshot: { currentIndex: number; positionMs: number; songIds: string[] },
) => {
    const positionMs = Math.round(snapshot.positionMs);

    await api.controller.savePlayQueue({
        apiClientProps: { serverId },
        query: {
            clientName: getThisDeviceClientName(),
            currentIndex: snapshot.songIds.length > 0 ? snapshot.currentIndex : undefined,
            positionMs,
            songs: snapshot.songIds,
        },
    });

    writeKnownQueueSignature(
        serverId,
        getQueueSignature(snapshot.songIds, snapshot.currentIndex, positionMs),
    );
};

export const saveQueueToServer = async (serverId: string) => {
    const state = usePlayerStore.getState();
    const queue = state.getQueue();

    if (queue.items.some((item) => item._serverId !== serverId)) {
        throw new Error(t('error.multipleServerSaveQueueError'));
    }

    await saveQueueSnapshotToServer(serverId, {
        currentIndex: queue.items.length > 0 ? state.player.index : 0,
        positionMs: useTimestampStoreBase.getState().timestamp * 1000,
        songIds: queue.items.map((item) => item.id),
    });
};

export const applyServerQueue = (
    player: ReturnType<typeof usePlayer>,
    serverId: string,
    queue: GetQueueResponse,
    { autoplay }: { autoplay: boolean } = { autoplay: true },
) => {
    if (autoplay) suppressQueueSaves(QUEUE_SAVE_SUPPRESSION_AFTER_RESTORE_MS);
    writeKnownQueueSignature(serverId, getServerQueueSignature(queue));

    player.setQueue(
        queue.entry,
        queue.currentIndex,
        queue.positionMs !== undefined ? queue.positionMs / 1000 : undefined,
        autoplay,
    );
};

export const fetchServerQueue = (queryClient: QueryClient, serverId: string) =>
    queryClient.fetchQuery({ ...songsQueries.getQueue({ query: {}, serverId }), staleTime: 0 });

export const continueServerQueue = async (
    player: ReturnType<typeof usePlayer>,
    queryClient: QueryClient,
    serverId: string,
    { autoplay }: { autoplay: boolean },
) => {
    const queue = await fetchServerQueue(queryClient, serverId);

    if (queue.entry.length === 0) return false;

    applyServerQueue(player, serverId, queue, { autoplay });
    return true;
};

export const getServerQueueCurrentSong = (queue: GetQueueResponse) =>
    queue.entry[queue.currentIndex] ?? queue.entry[0];
