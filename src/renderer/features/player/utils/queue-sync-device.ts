import isElectron from 'is-electron';

const DEVICE_ID_STORAGE_KEY = 'queue-sync-device-id';
const CLIENT_NAME_PATTERN = /^Feishin \((.+)\) \[([a-z0-9]+)\]$/;

let cachedDeviceId: null | string = null;

const createDeviceId = () => Math.random().toString(36).slice(2, 10);

export const getQueueSyncDeviceId = () => {
    if (cachedDeviceId) return cachedDeviceId;

    try {
        cachedDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
        if (!cachedDeviceId) {
            cachedDeviceId = createDeviceId();
            localStorage.setItem(DEVICE_ID_STORAGE_KEY, cachedDeviceId);
        }
    } catch {
        cachedDeviceId = createDeviceId();
    }

    return cachedDeviceId;
};

const getOperatingSystemName = (userAgent: string) => {
    if (/android/i.test(userAgent)) return 'Android';
    if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
    if (/windows/i.test(userAgent)) return 'Windows';
    if (/mac os/i.test(userAgent)) return 'macOS';
    if (/linux/i.test(userAgent)) return 'Linux';
    return '';
};

const getBrowserName = (userAgent: string) => {
    if (/edg\//i.test(userAgent)) return 'Edge';
    if (/firefox\//i.test(userAgent)) return 'Firefox';
    if (/chrome\//i.test(userAgent)) return 'Chrome';
    if (/safari\//i.test(userAgent)) return 'Safari';
    return 'Browser';
};

export const getDefaultQueueSyncDeviceName = () => {
    const userAgent = navigator.userAgent;
    const operatingSystemName = getOperatingSystemName(userAgent);

    if (isElectron()) {
        return operatingSystemName ? `${operatingSystemName} desktop` : 'Desktop';
    }

    const browserName = getBrowserName(userAgent);
    return operatingSystemName ? `${browserName} on ${operatingSystemName}` : browserName;
};

export const resolveQueueSyncDeviceName = (configuredDeviceName: string) =>
    configuredDeviceName.trim() || getDefaultQueueSyncDeviceName();

export const formatQueueSyncClientName = (deviceName: string) =>
    `Feishin (${deviceName}) [${getQueueSyncDeviceId()}]`;

export const parseQueueSyncClientName = (changedBy: string) => {
    const match = CLIENT_NAME_PATTERN.exec(changedBy);

    if (!match) {
        return { deviceId: undefined, deviceName: changedBy, isThisDevice: false };
    }

    const [, deviceName, deviceId] = match;
    return { deviceId, deviceName, isThisDevice: deviceId === getQueueSyncDeviceId() };
};
