import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getDefaultQueueSyncDeviceName } from '/@/renderer/features/player/utils/queue-sync-device';
import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import {
    QUEUE_SYNC_REMOTE_ACTION,
    QUEUE_SYNC_TAKEOVER_ACTION,
    type QueueSyncRemoteAction,
    type QueueSyncTakeoverAction,
    useQueueSyncSettings,
    useSettingsStoreActions,
} from '/@/renderer/store/settings.store';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { Select } from '/@/shared/components/select/select';
import { Switch } from '/@/shared/components/switch/switch';
import { TextInput } from '/@/shared/components/text-input/text-input';

export const QueueSyncSettings = memo(() => {
    const { t } = useTranslation();
    const settings = useQueueSyncSettings();
    const { setSettings } = useSettingsStoreActions();

    const remoteActionSelectData = useMemo(
        () => [
            {
                label: t('setting.queueSync_remoteAction_option_ask'),
                value: QUEUE_SYNC_REMOTE_ACTION.ASK,
            },
            {
                label: t('setting.queueSync_remoteAction_option_continueIfEmpty'),
                value: QUEUE_SYNC_REMOTE_ACTION.CONTINUE_IF_EMPTY,
            },
            {
                label: t('setting.queueSync_remoteAction_option_alwaysContinue'),
                value: QUEUE_SYNC_REMOTE_ACTION.ALWAYS_CONTINUE,
            },
            {
                label: t('setting.queueSync_remoteAction_option_neverNotify'),
                value: QUEUE_SYNC_REMOTE_ACTION.NEVER_NOTIFY,
            },
        ],
        [t],
    );

    const takeoverActionSelectData = useMemo(
        () => [
            {
                label: t('setting.queueSync_takeoverAction_option_pause'),
                value: QUEUE_SYNC_TAKEOVER_ACTION.PAUSE,
            },
            {
                label: t('setting.queueSync_takeoverAction_option_keepPlaying'),
                value: QUEUE_SYNC_TAKEOVER_ACTION.KEEP_PLAYING,
            },
        ],
        [t],
    );

    const queueSyncOptions: SettingOption[] = [
        {
            control: (
                <Switch
                    aria-label={t('setting.queueSync_enabled')}
                    checked={settings.enabled}
                    onChange={(e) => {
                        setSettings({ queueSync: { enabled: e.currentTarget.checked } });
                    }}
                />
            ),
            description: t('setting.queueSync_enabled_description'),
            title: t('setting.queueSync_enabled'),
        },
        {
            control: (
                <TextInput
                    aria-label={t('setting.queueSync_deviceName')}
                    defaultValue={settings.deviceName}
                    onBlur={(e) => {
                        setSettings({ queueSync: { deviceName: e.currentTarget.value.trim() } });
                    }}
                    placeholder={getDefaultQueueSyncDeviceName()}
                />
            ),
            description: t('setting.queueSync_deviceName_description'),
            isHidden: !settings.enabled,
            title: t('setting.queueSync_deviceName'),
        },
        {
            control: (
                <Select
                    data={remoteActionSelectData}
                    onChange={(value) =>
                        value &&
                        setSettings({
                            queueSync: { remoteAction: value as QueueSyncRemoteAction },
                        })
                    }
                    value={settings.remoteAction}
                    w="100%"
                />
            ),
            description: t('setting.queueSync_remoteAction_description'),
            isHidden: !settings.enabled,
            title: t('setting.queueSync_remoteAction'),
        },
        {
            control: (
                <Switch
                    aria-label={t('setting.queueSync_autoplayOnAutoContinue')}
                    checked={settings.autoplayOnAutoContinue}
                    onChange={(e) => {
                        setSettings({
                            queueSync: { autoplayOnAutoContinue: e.currentTarget.checked },
                        });
                    }}
                />
            ),
            description: t('setting.queueSync_autoplayOnAutoContinue_description'),
            isHidden:
                !settings.enabled ||
                settings.remoteAction === QUEUE_SYNC_REMOTE_ACTION.ASK ||
                settings.remoteAction === QUEUE_SYNC_REMOTE_ACTION.NEVER_NOTIFY,
            title: t('setting.queueSync_autoplayOnAutoContinue'),
        },
        {
            control: (
                <Select
                    data={takeoverActionSelectData}
                    onChange={(value) =>
                        value &&
                        setSettings({
                            queueSync: { takeoverAction: value as QueueSyncTakeoverAction },
                        })
                    }
                    value={settings.takeoverAction}
                    w="100%"
                />
            ),
            description: t('setting.queueSync_takeoverAction_description'),
            isHidden: !settings.enabled,
            title: t('setting.queueSync_takeoverAction'),
        },
        {
            control: (
                <NumberInput
                    aria-label={t('setting.queueSync_intervalSeconds')}
                    hideControls={false}
                    max={120}
                    min={5}
                    onChange={(value) => {
                        const intervalSeconds = Number(value);
                        if (intervalSeconds < 5 || intervalSeconds > 120) return;
                        setSettings({ queueSync: { intervalSeconds } });
                    }}
                    value={settings.intervalSeconds}
                />
            ),
            description: t('setting.queueSync_intervalSeconds_description'),
            isHidden: !settings.enabled,
            title: t('setting.queueSync_intervalSeconds'),
        },
    ];

    return <SettingsSection options={queueSyncOptions} title={t('setting.queueSync')} />;
});
