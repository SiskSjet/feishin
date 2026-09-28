import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { useCallback, useEffect, useRef } from 'react';

import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    applyServerQueue,
    fetchServerQueue,
    saveQueueToServer,
} from '/@/renderer/features/player/utils/queue-sync';
import {
    setTimestamp,
    useCurrentServerId,
    usePlayerActions,
    usePlayerHydrated,
    usePlayerSong,
    usePlayerStatus,
    usePlayerStore,
    useTimestampStoreBase,
} from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { PlayerStatus } from '/@/shared/types/types';

let startupRestoreSessionHandled = false;

const RESTORE_SEEK_TOLERANCE_SECONDS = 2;
const RESTORE_SEEK_MAX_ATTEMPTS = 5;

export const useQueueRestoreTimestamp = () => {
    const { mediaSeekToTimestamp } = usePlayerActions();
    const pendingRestoreSeekRef = useRef<null | {
        attemptsLeft: number;
        seconds: number;
        uniqueId?: string;
    }>(null);

    const seekWithoutRetrigger = useCallback(
        (seconds: number) => {
            const pendingRestoreSeek = pendingRestoreSeekRef.current;
            pendingRestoreSeekRef.current = null;
            mediaSeekToTimestamp(seconds);
            pendingRestoreSeekRef.current = pendingRestoreSeek;
        },
        [mediaSeekToTimestamp],
    );

    usePlayerEvents(
        {
            onPlayerProgress: ({ timestamp }) => {
                const pendingRestoreSeek = pendingRestoreSeekRef.current;
                if (!pendingRestoreSeek) return;

                const currentUniqueId = usePlayerStore.getState().getCurrentSong()?._uniqueId;

                if (
                    currentUniqueId !== pendingRestoreSeek.uniqueId ||
                    pendingRestoreSeek.attemptsLeft <= 0 ||
                    timestamp >= pendingRestoreSeek.seconds - RESTORE_SEEK_TOLERANCE_SECONDS
                ) {
                    pendingRestoreSeekRef.current = null;
                    return;
                }

                pendingRestoreSeek.attemptsLeft -= 1;
                seekWithoutRetrigger(pendingRestoreSeek.seconds);
            },
            onQueueRestored: ({ position }) => {
                pendingRestoreSeekRef.current = null;
                if (position <= 0) return;

                setTimestamp(position);
                mediaSeekToTimestamp(position);

                pendingRestoreSeekRef.current = {
                    attemptsLeft: RESTORE_SEEK_MAX_ATTEMPTS,
                    seconds: position,
                    uniqueId: usePlayerStore.getState().getCurrentSong()?._uniqueId,
                };
            },
        },
        [mediaSeekToTimestamp, seekWithoutRetrigger],
    );
};

export const QueueRestoreTimestampHook = () => {
    useQueueRestoreTimestamp();
    return null;
};

export const useInitialTimestampRestore = () => {
    const { mediaSeekToTimestamp } = usePlayerActions();
    const playerHydrated = usePlayerHydrated();
    const currentSong = usePlayerSong();
    const playerStatus = usePlayerStatus();
    const timestamp = useTimestampStoreBase((state) => state.timestamp);

    const startupRestoreInitializedRef = useRef(false);
    const startupSeekArmedRef = useRef<null | number>(null);
    const startupSeekTargetUniqueIdRef = useRef<null | string>(null);
    const startupSeekAppliedRef = useRef(false);

    const cancelStartupSeek = useCallback(() => {
        if (startupSeekAppliedRef.current) {
            return;
        }

        startupSeekAppliedRef.current = true;
        startupSeekArmedRef.current = null;
        startupSeekTargetUniqueIdRef.current = null;
    }, []);

    const applyStartupSeek = useCallback(() => {
        const seekTimestamp = startupSeekArmedRef.current;

        if (startupSeekAppliedRef.current) {
            return;
        }

        if (!seekTimestamp || seekTimestamp <= 0) {
            return;
        }

        const targetUniqueId = startupSeekTargetUniqueIdRef.current;
        const currentUniqueId = usePlayerStore.getState().getCurrentSong()?._uniqueId;

        if (targetUniqueId && currentUniqueId !== targetUniqueId) {
            cancelStartupSeek();
            return;
        }

        startupSeekAppliedRef.current = true;
        startupSeekArmedRef.current = null;
        startupSeekTargetUniqueIdRef.current = null;

        setTimeout(() => {
            mediaSeekToTimestamp(seekTimestamp);
        }, 100);
    }, [cancelStartupSeek, mediaSeekToTimestamp]);

    useEffect(() => {
        const targetUniqueId = startupSeekTargetUniqueIdRef.current;
        if (
            !targetUniqueId ||
            startupSeekAppliedRef.current ||
            !currentSong ||
            currentSong._uniqueId === targetUniqueId
        ) {
            return;
        }

        cancelStartupSeek();
    }, [cancelStartupSeek, currentSong]);

    useEffect(() => {
        if (startupRestoreInitializedRef.current || startupRestoreSessionHandled) {
            return;
        }

        if (!playerHydrated || !currentSong) {
            return;
        }

        startupRestoreInitializedRef.current = true;
        startupRestoreSessionHandled = true;

        if (timestamp > 0) {
            startupSeekArmedRef.current = timestamp;
            startupSeekTargetUniqueIdRef.current = currentSong._uniqueId;
        }

        if (playerStatus === PlayerStatus.PLAYING) {
            applyStartupSeek();
        }
    }, [applyStartupSeek, currentSong, playerHydrated, playerStatus, timestamp]);

    usePlayerEvents(
        {
            onPlayerStatus: (properties) => {
                if (properties.status === PlayerStatus.PLAYING) {
                    applyStartupSeek();
                }
            },
        },
        [applyStartupSeek],
    );
};

export const InitialTimestampRestoreHook = () => {
    useInitialTimestampRestore();
    return null;
};

export const useSaveQueue = () => {
    const serverId = useCurrentServerId();

    const mutation = useMutation({
        mutationFn: async () => {
            if (!serverId) {
                throw new Error(t('error.serverRequired'));
            }

            return saveQueueToServer(serverId);
        },
        onError: (error) => {
            toast.error({
                message: (error as Error).message,
                title: t('error.saveQueueFailed'),
            });
        },
    });

    return mutation;
};

export const useRestoreQueue = () => {
    const serverId = useCurrentServerId();
    const player = usePlayer();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            if (!serverId) {
                throw new Error(t('error.serverRequired'));
            }

            const queue = await fetchServerQueue(queryClient, serverId);
            applyServerQueue(player, serverId, queue);
        },
        onError: (error) => {
            toast.error({
                message: (error as Error).message,
                title: t('error.genericError'),
            });
        },
    });
};
