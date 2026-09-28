import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RemoteQueueSummary } from '/@/renderer/features/player/components/remote-queue-summary';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { continueServerQueue } from '/@/renderer/features/player/utils/queue-sync';
import {
    parseQueueSyncClientName,
    resolveQueueSyncDeviceName,
} from '/@/renderer/features/player/utils/queue-sync-device';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { useCurrentServer, usePlayerStatus } from '/@/renderer/store';
import { useQueueSyncSettings, useSettingsStoreActions } from '/@/renderer/store/settings.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Divider } from '/@/shared/components/divider/divider';
import { Group } from '/@/shared/components/group/group';
import { Popover } from '/@/shared/components/popover/popover';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Switch } from '/@/shared/components/switch/switch';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { ServerType } from '/@/shared/types/domain-types';
import { PlayerStatus } from '/@/shared/types/types';

const OPEN_POPOVER_REFRESH_INTERVAL_MS = 5000;

export const QueueSyncButton = () => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const serverId = server?.id;
    const settings = useQueueSyncSettings();
    const { setSettings } = useSettingsStoreActions();
    const playerStatus = usePlayerStatus();
    const player = usePlayer();
    const queryClient = useQueryClient();
    const [opened, setOpened] = useState(false);
    const [isContinuing, setIsContinuing] = useState(false);

    const serverQueueQuery = useQuery({
        ...songsQueries.getQueue({ query: {}, serverId: serverId ?? '' }),
        enabled: opened && !!serverId,
        refetchInterval: opened ? OPEN_POPOVER_REFRESH_INTERVAL_MS : false,
        staleTime: 0,
    });

    if (!serverId || server?.type === ServerType.JELLYFIN) return null;

    const serverQueue = serverQueueQuery.data;
    const hasServerQueue = !!serverQueue && serverQueue.entry.length > 0;
    const serverQueueIsFromThisDevice =
        hasServerQueue && parseQueueSyncClientName(serverQueue.changedBy).isThisDevice;

    const handleContinue = async (autoplay: boolean) => {
        setIsContinuing(true);

        try {
            const continued = await continueServerQueue(player, queryClient, serverId, {
                autoplay,
            });

            if (!continued) toast.info({ message: t('player.queueSync.nothingToContinue') });
            setOpened(false);
        } catch (error) {
            toast.error({
                message: (error as Error).message,
                title: t('error.genericError'),
            });
        } finally {
            setIsContinuing(false);
        }
    };

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
            <Popover.Dropdown maw={400} miw={320} onClick={(e) => e.stopPropagation()} p="md">
                <Stack gap="sm">
                    <Group justify="space-between" wrap="nowrap">
                        <Stack gap={0}>
                            <Text fw={600} size="sm">
                                {t('player.queueSync.devices')}
                            </Text>
                            <Text isMuted size="xs">
                                {t('player.queueSync.thisDeviceNamed', {
                                    name: resolveQueueSyncDeviceName(settings.deviceName),
                                })}
                                {' · '}
                                {playerStatus === PlayerStatus.PLAYING
                                    ? t('player.queueSync.statusPlaying')
                                    : t('player.queueSync.statusIdle')}
                            </Text>
                        </Stack>
                        <Switch
                            aria-label={t('setting.queueSync_enabled')}
                            checked={settings.enabled}
                            onChange={(e) =>
                                setSettings({ queueSync: { enabled: e.currentTarget.checked } })
                            }
                        />
                    </Group>
                    <Divider />
                    <Text fw={600} size="xs">
                        {t('player.queueSync.lastSession')}
                    </Text>
                    {serverQueueQuery.isLoading ? (
                        <Group justify="center" py="sm">
                            <Spinner />
                        </Group>
                    ) : hasServerQueue ? (
                        <>
                            <RemoteQueueSummary queue={serverQueue} />
                            {serverQueueIsFromThisDevice ? (
                                <Text isMuted size="xs">
                                    {t('player.queueSync.sessionIsThisDevice')}
                                </Text>
                            ) : (
                                <Group gap="xs" grow>
                                    <Button
                                        loading={isContinuing}
                                        onClick={() => handleContinue(true)}
                                        size="compact-sm"
                                        variant="filled"
                                    >
                                        {t('player.queueSync.continueHere')}
                                    </Button>
                                    <Button
                                        disabled={isContinuing}
                                        onClick={() => handleContinue(false)}
                                        size="compact-sm"
                                        variant="default"
                                    >
                                        {t('player.queueSync.loadPaused')}
                                    </Button>
                                </Group>
                            )}
                        </>
                    ) : (
                        <Text isMuted size="xs">
                            {t('player.queueSync.noSession')}
                        </Text>
                    )}
                    <Text isMuted size="xs">
                        {t('player.queueSync.oneQueueHint')}
                    </Text>
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
};
