import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    formatSongPosition,
    SongSessionSummary,
} from '/@/renderer/features/player/components/remote-queue-summary';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    applyServerQueue,
    fetchServerQueue,
    getServerQueueCurrentSong,
} from '/@/renderer/features/player/utils/queue-sync';
import { parseQueueSyncClientName } from '/@/renderer/features/player/utils/queue-sync-device';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { useCurrentServer, usePlayerSong } from '/@/renderer/store';
import { useQueueSyncSettings, useSettingsStoreActions } from '/@/renderer/store/settings.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Divider } from '/@/shared/components/divider/divider';
import { Group } from '/@/shared/components/group/group';
import { Popover } from '/@/shared/components/popover/popover';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Switch } from '/@/shared/components/switch/switch';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { GetQueueResponse, NowPlayingEntry, ServerType, Song } from '/@/shared/types/domain-types';

const OPEN_POPOVER_REFRESH_INTERVAL_MS = 5000;
const POSITION_TICK_INTERVAL_MS = 1000;
const UNTAGGED_FEISHIN_CLIENT_NAME = 'Feishin';

type DeviceSession = {
    deviceName: string;
    holdsQueue: boolean;
    key: string;
    liveEntry?: NowPlayingEntry;
    queueSongCount?: number;
    savedPositionMs?: number;
    song: Song;
};

const interpolatePositionMs = (entry: NowPlayingEntry, fetchedAtMs: number, nowMs: number) => {
    if (entry.positionMs === undefined) return undefined;
    if (entry.state !== 'playing') return entry.positionMs;

    const elapsedMs = Math.max(0, nowMs - fetchedAtMs) * (entry.playbackRate ?? 1);
    return Math.min(entry.positionMs + elapsedMs, entry.song.duration || Infinity);
};

const usePositionTicker = (active: boolean) => {
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        if (!active) return;

        setNowMs(Date.now());
        const tickInterval = setInterval(() => setNowMs(Date.now()), POSITION_TICK_INTERVAL_MS);

        return () => clearInterval(tickInterval);
    }, [active]);

    return nowMs;
};

const isEntryFromQueueHolder = (entry: NowPlayingEntry, serverQueue: GetQueueResponse) => {
    const holderDeviceId = parseQueueSyncClientName(serverQueue.changedBy).deviceId;
    const entryDeviceId = parseQueueSyncClientName(entry.playerName).deviceId;

    return holderDeviceId
        ? entryDeviceId === holderDeviceId
        : entry.playerName === serverQueue.changedBy;
};

const buildDeviceSessions = ({
    localSongId,
    nowPlayingEntries,
    serverQueue,
    unknownDeviceLabel,
    username,
}: {
    localSongId: string | undefined;
    nowPlayingEntries: NowPlayingEntry[];
    serverQueue: GetQueueResponse | undefined;
    unknownDeviceLabel: string;
    username: string;
}) => {
    const activeEntries = nowPlayingEntries.filter((entry) => {
        if (entry.username.toLowerCase() !== username.toLowerCase()) return false;
        if (entry.state === 'stopped') return false;
        if (parseQueueSyncClientName(entry.playerName).isThisDevice) return false;

        const isProbablyThisUntaggedDevice =
            entry.playerName === UNTAGGED_FEISHIN_CLIENT_NAME && entry.song.id === localSongId;
        return !isProbablyThisUntaggedDevice;
    });

    const sessions: DeviceSession[] = [];
    const queueHolder = serverQueue ? parseQueueSyncClientName(serverQueue.changedBy) : undefined;
    const queueSong = serverQueue ? getServerQueueCurrentSong(serverQueue) : undefined;
    let queueHolderEntry: NowPlayingEntry | undefined;

    if (serverQueue && queueHolder && queueSong && !queueHolder.isThisDevice) {
        queueHolderEntry = activeEntries.find((entry) =>
            isEntryFromQueueHolder(entry, serverQueue),
        );

        sessions.push({
            deviceName: queueHolder.deviceName || unknownDeviceLabel,
            holdsQueue: true,
            key: `queue-${serverQueue.changedBy}`,
            liveEntry: queueHolderEntry,
            queueSongCount: serverQueue.entry.length,
            savedPositionMs: serverQueue.positionMs,
            song: queueHolderEntry?.song ?? queueSong,
        });
    }

    activeEntries
        .filter((entry) => entry !== queueHolderEntry)
        .forEach((entry) => {
            sessions.push({
                deviceName:
                    parseQueueSyncClientName(entry.playerName).deviceName || unknownDeviceLabel,
                holdsQueue: false,
                key: `now-playing-${entry.playerId ?? entry.playerName}-${entry.song.id}`,
                liveEntry: entry,
                song: entry.song,
            });
        });

    return sessions;
};

export const QueueSyncButton = () => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const serverId = server?.id;
    const settings = useQueueSyncSettings();
    const { setSettings } = useSettingsStoreActions();
    const player = usePlayer();
    const queryClient = useQueryClient();
    const localSongId = usePlayerSong()?.id;
    const [opened, setOpened] = useState(false);
    const [continuingSessionKey, setContinuingSessionKey] = useState<null | string>(null);
    const isSupportedServer = !!serverId && server?.type !== ServerType.JELLYFIN;
    const nowMs = usePositionTicker(opened);

    const nowPlayingQuery = useQuery({
        ...songsQueries.getNowPlaying({ query: {}, serverId: serverId ?? '' }),
        enabled: opened && isSupportedServer,
        refetchInterval: opened ? OPEN_POPOVER_REFRESH_INTERVAL_MS : false,
        staleTime: 0,
    });

    const serverQueueQuery = useQuery({
        ...songsQueries.getQueue({ query: {}, serverId: serverId ?? '' }),
        enabled: opened && isSupportedServer,
        refetchInterval: opened ? OPEN_POPOVER_REFRESH_INTERVAL_MS : false,
        staleTime: 0,
    });

    if (!isSupportedServer || !server) return null;

    const serverQueue =
        serverQueueQuery.data && serverQueueQuery.data.entry.length > 0
            ? serverQueueQuery.data
            : undefined;

    const deviceSessions = buildDeviceSessions({
        localSongId,
        nowPlayingEntries: nowPlayingQuery.data ?? [],
        serverQueue,
        unknownDeviceLabel: t('player.queueSync.unknownDevice'),
        username: server.username ?? '',
    });

    const getLivePositionMs = (session: DeviceSession) =>
        session.liveEntry
            ? interpolatePositionMs(session.liveEntry, nowPlayingQuery.dataUpdatedAt, nowMs)
            : session.savedPositionMs;

    const getSessionDetails = (session: DeviceSession) => {
        const stateLabel = !session.liveEntry
            ? t('player.queueSync.statusSaved')
            : session.liveEntry.state === 'paused'
              ? t('player.queueSync.statusPaused')
              : t('player.queueSync.statusPlaying');
        const positionMs = getLivePositionMs(session);
        const progressLabel =
            positionMs !== undefined
                ? formatSongPosition(positionMs, session.song.duration)
                : t('player.queueSync.startedMinutesAgo', {
                      count: session.liveEntry?.minutesAgo ?? 0,
                  });

        return [session.deviceName, stateLabel, progressLabel];
    };

    const continueQueue = async (session: DeviceSession) => {
        const freshQueue = await fetchServerQueue(queryClient, serverId);
        const freshQueueSong = getServerQueueCurrentSong(freshQueue);

        if (!freshQueueSong) {
            toast.info({ message: t('player.queueSync.nothingToContinue') });
            return;
        }

        const livePositionMs =
            session.liveEntry?.song.id === freshQueueSong.id
                ? getLivePositionMs(session)
                : undefined;

        applyServerQueue(
            player,
            serverId,
            livePositionMs !== undefined
                ? { ...freshQueue, positionMs: livePositionMs }
                : freshQueue,
            { autoplay: true },
        );
    };

    const continueSong = (session: DeviceSession) => {
        player.setQueue([session.song], 0, (getLivePositionMs(session) ?? 0) / 1000, true);
    };

    const handleContinue = async (session: DeviceSession) => {
        setContinuingSessionKey(session.key);

        try {
            if (session.holdsQueue) {
                await continueQueue(session);
            } else {
                continueSong(session);
            }
            setOpened(false);
        } catch (error) {
            toast.error({
                message: (error as Error).message,
                title: t('error.genericError'),
            });
        } finally {
            setContinuingSessionKey(null);
        }
    };

    const isInitialLoading =
        (nowPlayingQuery.isLoading || serverQueueQuery.isLoading) && deviceSessions.length === 0;

    return (
        <Popover onChange={setOpened} opened={opened} position="top" withArrow>
            <Popover.Target>
                <ActionIcon
                    icon="devices"
                    iconProps={{
                        color: settings.enabled ? 'primary' : undefined,
                        size: 'lg',
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpened((prev) => !prev);
                    }}
                    size="sm"
                    tooltip={{ label: t('player.queueSync.devices'), openDelay: 0 }}
                    variant="subtle"
                />
            </Popover.Target>
            <Popover.Dropdown maw={420} miw={320} onClick={(e) => e.stopPropagation()} p="md">
                <Stack gap="sm">
                    <Group justify="space-between" wrap="nowrap">
                        <Text fw={600} size="sm">
                            {t('player.queueSync.devices')}
                        </Text>
                        <Switch
                            aria-label={t('setting.queueSync_enabled')}
                            checked={settings.enabled}
                            label={t('player.queueSync.syncQueue')}
                            onChange={(e) =>
                                setSettings({ queueSync: { enabled: e.currentTarget.checked } })
                            }
                        />
                    </Group>
                    <Divider />
                    {isInitialLoading ? (
                        <Group justify="center" py="sm">
                            <Spinner />
                        </Group>
                    ) : deviceSessions.length === 0 ? (
                        <Text isMuted size="xs">
                            {t('player.queueSync.noOtherDevices')}
                        </Text>
                    ) : (
                        deviceSessions.map((session) => (
                            <Group gap="xs" justify="space-between" key={session.key} wrap="nowrap">
                                <SongSessionSummary
                                    details={getSessionDetails(session)}
                                    song={session.song}
                                />
                                <Stack align="flex-end" gap={4}>
                                    {session.holdsQueue && (
                                        <Badge size="xs">
                                            {t('player.queueSync.queueBadge', {
                                                count: session.queueSongCount,
                                            })}
                                        </Badge>
                                    )}
                                    <Button
                                        disabled={
                                            continuingSessionKey !== null &&
                                            continuingSessionKey !== session.key
                                        }
                                        loading={continuingSessionKey === session.key}
                                        onClick={() => handleContinue(session)}
                                        size="compact-xs"
                                        variant={session.holdsQueue ? 'filled' : 'default'}
                                    >
                                        {session.holdsQueue
                                            ? t('player.queueSync.continueQueue')
                                            : t('player.queueSync.continueSong')}
                                    </Button>
                                </Stack>
                            </Group>
                        ))
                    )}
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
};
