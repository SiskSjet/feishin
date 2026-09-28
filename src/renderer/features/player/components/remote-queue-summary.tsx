import formatDuration from 'format-duration';
import { useTranslation } from 'react-i18next';

import styles from './remote-queue-summary.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { getServerQueueCurrentSong } from '/@/renderer/features/player/utils/queue-sync';
import { parseQueueSyncClientName } from '/@/renderer/features/player/utils/queue-sync-device';
import { formatDateRelative } from '/@/renderer/utils/format';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { GetQueueResponse, LibraryItem } from '/@/shared/types/domain-types';

interface RemoteQueueSummaryProps {
    queue: GetQueueResponse;
}

export const RemoteQueueSummary = ({ queue }: RemoteQueueSummaryProps) => {
    const { t } = useTranslation();
    const song = getServerQueueCurrentSong(queue);
    const { deviceName, isThisDevice } = parseQueueSyncClientName(queue.changedBy);

    if (!song) return null;

    const deviceLabel = isThisDevice
        ? t('player.queueSync.thisDevice')
        : deviceName || t('player.queueSync.unknownDevice');
    const positionLabel = song.duration
        ? `${formatDuration(queue.positionMs)} / ${formatDuration(song.duration)}`
        : formatDuration(queue.positionMs);
    const detailParts = [
        deviceLabel,
        positionLabel,
        t('player.queueSync.songCount', { count: queue.entry.length }),
        formatDateRelative(queue.changed),
    ].filter(Boolean);

    return (
        <Group gap="sm" wrap="nowrap">
            <div className={styles.cover}>
                <ItemImage
                    blurHash={song.blurHash}
                    enableDebounce={false}
                    enableViewport={false}
                    explicitStatus={song.explicitStatus}
                    id={song.imageId}
                    itemType={LibraryItem.SONG}
                    serverId={song._serverId}
                    thumbHash={song.thumbHash}
                    type="table"
                />
            </div>
            <Stack className={styles.details} gap={0}>
                <Text fw={600} overflow="hidden" size="sm">
                    {song.name}
                </Text>
                <Text isMuted overflow="hidden" size="xs">
                    {song.artistName}
                </Text>
                <Text isMuted overflow="hidden" size="xs">
                    {detailParts.join(' · ')}
                </Text>
            </Stack>
        </Group>
    );
};
