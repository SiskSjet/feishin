import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { RemoteQueueSummary } from '/@/renderer/features/player/components/remote-queue-summary';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    applyServerQueue,
    areQueueSavesSuppressed,
    continueServerQueue,
    dismissServerQueueSession,
    fetchServerQueue,
    isServerQueueFromOtherDevice,
    isServerQueueSessionDismissed,
    saveQueueSnapshotToServer,
    saveQueueToServer,
    suppressQueueSaves,
} from '/@/renderer/features/player/utils/queue-sync';
import {
    useCurrentServer,
    usePlayerHydrated,
    usePlayerStatus,
    usePlayerStore,
} from '/@/renderer/store';
import {
    QUEUE_SYNC_REMOTE_ACTION,
    QUEUE_SYNC_TAKEOVER_ACTION,
    useQueueSyncSettings,
} from '/@/renderer/store/settings.store';
import { logger } from '/@/renderer/utils/logger';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';
import { toast } from '/@/shared/components/toast/toast';
import { GetQueueResponse, ServerType } from '/@/shared/types/domain-types';
import { PlayerStatus } from '/@/shared/types/types';

const TAKEOVER_PAUSE_SUPPRESSION_MS = 1500;
const CLAIM_POSITION_OFFSET_MS = 1;
const REMOTE_QUEUE_TOAST_ID = 'queue-sync-remote';

type SyncReason = 'interval' | 'pause' | 'songChange' | 'startup' | 'windowActivity';

const isPlaying = () => usePlayerStore.getState().player.status === PlayerStatus.PLAYING;

const hasLocalQueue = () => usePlayerStore.getState().getQueue().items.length > 0;

export const useQueueSync = () => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const serverId = server?.id;
    const settings = useQueueSyncSettings();
    const enabled = settings.enabled && !!serverId && server?.type !== ServerType.JELLYFIN;
    const playerHydrated = usePlayerHydrated();
    const playerStatus = usePlayerStatus();
    const player = usePlayer();
    const queryClient = useQueryClient();
    const syncInFlightRef = useRef(false);
    const remoteToastOpenRef = useRef(false);
    const continuingHereRef = useRef(false);
    const detachedFromSyncRef = useRef(false);

    const claimPlayback = useCallback(() => {
        if (!enabled || !serverId || areQueueSavesSuppressed() || !hasLocalQueue()) return;

        saveQueueToServer(serverId).catch((error) => {
            logger.warn('Queue sync claim failed', { error, serverId });
        });
    }, [enabled, serverId]);

    const continueHere = useCallback(async () => {
        if (!serverId) return;

        try {
            detachedFromSyncRef.current = false;
            const continued = await continueServerQueue(player, queryClient, serverId, {
                autoplay: true,
            });

            if (!continued) toast.info({ message: t('player.queueSync.nothingToContinue') });
        } catch (error) {
            toast.error({
                message: (error as Error).message,
                title: t('error.genericError'),
            });
        }
    }, [player, queryClient, serverId, t]);

    const showRemoteQueueToast = useCallback(
        (message: string, remoteQueue: GetQueueResponse) => {
            if (!serverId) return;

            if (remoteToastOpenRef.current) toast.hide(REMOTE_QUEUE_TOAST_ID);

            remoteToastOpenRef.current = true;
            continuingHereRef.current = false;

            toast.info({
                autoClose: false,
                id: REMOTE_QUEUE_TOAST_ID,
                message: (
                    <Stack gap="xs" mt="xs">
                        {message}
                        <RemoteQueueSummary queue={remoteQueue} />
                        <Button
                            onClick={() => {
                                continuingHereRef.current = true;
                                toast.hide(REMOTE_QUEUE_TOAST_ID);
                                continueHere();
                            }}
                            size="compact-sm"
                            variant="filled"
                        >
                            {t('player.queueSync.continueHere')}
                        </Button>
                    </Stack>
                ),
                onClose: () => {
                    remoteToastOpenRef.current = false;
                    if (!continuingHereRef.current) {
                        dismissServerQueueSession(serverId, remoteQueue);
                    }
                },
            });
        },
        [continueHere, serverId, t],
    );

    const handleTakeover = useCallback(
        (remoteQueue: GetQueueResponse) => {
            if (detachedFromSyncRef.current) return;

            if (settings.takeoverAction === QUEUE_SYNC_TAKEOVER_ACTION.KEEP_PLAYING) {
                detachedFromSyncRef.current = true;
                showRemoteQueueToast(
                    t('player.queueSync.movedToOtherDeviceKeepPlaying'),
                    remoteQueue,
                );
                return;
            }

            suppressQueueSaves(TAKEOVER_PAUSE_SUPPRESSION_MS);
            player.mediaPause();
            showRemoteQueueToast(t('player.queueSync.movedToOtherDevice'), remoteQueue);
        },
        [player, settings.takeoverAction, showRemoteQueueToast, t],
    );

    const handleRemoteQueueWhileIdle = useCallback(
        (remoteQueue: GetQueueResponse, reason: SyncReason) => {
            if (!serverId || settings.remoteAction === QUEUE_SYNC_REMOTE_ACTION.NEVER_NOTIFY) {
                return;
            }

            const canAutoContinue =
                (reason === 'startup' || reason === 'windowActivity') &&
                document.visibilityState === 'visible';
            const shouldAutoContinue =
                canAutoContinue &&
                (settings.remoteAction === QUEUE_SYNC_REMOTE_ACTION.ALWAYS_CONTINUE ||
                    (settings.remoteAction === QUEUE_SYNC_REMOTE_ACTION.CONTINUE_IF_EMPTY &&
                        !hasLocalQueue()));

            if (shouldAutoContinue) {
                toast.hide(REMOTE_QUEUE_TOAST_ID);
                applyServerQueue(player, serverId, remoteQueue, {
                    autoplay: settings.autoplayOnAutoContinue,
                });
                toast.info({ message: t('player.queueSync.continued') });
                return;
            }

            if (
                remoteToastOpenRef.current ||
                isServerQueueSessionDismissed(serverId, remoteQueue)
            ) {
                return;
            }

            showRemoteQueueToast(t('player.queueSync.remoteNewer'), remoteQueue);
        },
        [
            player,
            serverId,
            settings.autoplayOnAutoContinue,
            settings.remoteAction,
            showRemoteQueueToast,
            t,
        ],
    );

    const syncWithServer = useCallback(
        async (reason: SyncReason) => {
            if (!enabled || !serverId || syncInFlightRef.current || areQueueSavesSuppressed()) {
                return;
            }

            syncInFlightRef.current = true;

            try {
                const remoteQueue = await fetchServerQueue(queryClient, serverId);

                if (!isServerQueueFromOtherDevice(serverId, remoteQueue)) {
                    const shouldSaveLocalQueue =
                        reason === 'interval' ||
                        reason === 'pause' ||
                        reason === 'songChange' ||
                        (reason === 'windowActivity' && isPlaying());

                    if (shouldSaveLocalQueue && !detachedFromSyncRef.current && hasLocalQueue()) {
                        await saveQueueToServer(serverId);
                    }
                    return;
                }

                logger.debug('Queue sync found queue from another device', {
                    changed: remoteQueue.changed,
                    changedBy: remoteQueue.changedBy,
                    reason,
                });

                if (isPlaying()) {
                    handleTakeover(remoteQueue);
                    return;
                }

                handleRemoteQueueWhileIdle(remoteQueue, reason);
            } catch (error) {
                logger.warn('Queue sync failed', { error, reason, serverId });
            } finally {
                syncInFlightRef.current = false;
            }
        },
        [enabled, handleRemoteQueueWhileIdle, handleTakeover, queryClient, serverId],
    );

    useEffect(() => {
        if (playerHydrated) syncWithServer('startup');
    }, [playerHydrated, syncWithServer]);

    useEffect(() => {
        if (!enabled) return;

        const handleWindowActivity = () => {
            syncWithServer('windowActivity');
        };

        window.addEventListener('focus', handleWindowActivity);
        window.addEventListener('pagehide', handleWindowActivity);
        document.addEventListener('visibilitychange', handleWindowActivity);

        return () => {
            window.removeEventListener('focus', handleWindowActivity);
            window.removeEventListener('pagehide', handleWindowActivity);
            document.removeEventListener('visibilitychange', handleWindowActivity);
        };
    }, [enabled, syncWithServer]);

    useEffect(() => {
        if (!enabled || playerStatus !== PlayerStatus.PLAYING) return;

        const syncInterval = setInterval(
            () => syncWithServer('interval'),
            settings.intervalSeconds * 1000,
        );

        return () => clearInterval(syncInterval);
    }, [enabled, playerStatus, settings.intervalSeconds, syncWithServer]);

    usePlayerEvents(
        {
            onCurrentSongChange: () => {
                if (isPlaying()) syncWithServer('songChange');
            },
            onPlayerStatus: (properties, prev) => {
                const startedPlaying =
                    prev.status !== PlayerStatus.PLAYING &&
                    properties.status === PlayerStatus.PLAYING;
                const stoppedPlaying =
                    prev.status === PlayerStatus.PLAYING &&
                    properties.status !== PlayerStatus.PLAYING;

                if (startedPlaying) {
                    detachedFromSyncRef.current = false;
                    continuingHereRef.current = true;
                    toast.hide(REMOTE_QUEUE_TOAST_ID);
                    claimPlayback();
                } else if (stoppedPlaying) {
                    syncWithServer('pause');
                }
            },
            onQueueRestored: ({ data, index, position }) => {
                if (!enabled || !serverId || !isPlaying()) return;

                detachedFromSyncRef.current = false;
                saveQueueSnapshotToServer(serverId, {
                    currentIndex: index,
                    positionMs: position * 1000 + CLAIM_POSITION_OFFSET_MS,
                    songIds: data.map((song) => song.id),
                }).catch((error) => {
                    logger.warn('Queue sync claim after restore failed', { error, serverId });
                });
            },
        },
        [claimPlayback, enabled, serverId, syncWithServer],
    );
};

export const QueueSyncHook = () => {
    useQueueSync();
    return null;
};
