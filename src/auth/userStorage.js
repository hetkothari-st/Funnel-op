const APP_PREFIXES = ['mt_', 'vl_', 'nifty_baseline'];

let currentNamespace = null;
let installed = false;

const shouldNamespace = (key) => {
    if (!currentNamespace || typeof key !== 'string') return false;
    return APP_PREFIXES.some((p) => key.startsWith(p));
};

const rewrite = (key) => `u:${currentNamespace}:${key}`;

export function installUserStorageShim() {
    if (installed) return;
    if (typeof window === 'undefined' || !window.localStorage) return;

    const proto = Object.getPrototypeOf(window.localStorage);
    const rawGet = proto.getItem;
    const rawSet = proto.setItem;
    const rawRemove = proto.removeItem;

    proto.getItem = function (key) {
        if (shouldNamespace(key)) return rawGet.call(this, rewrite(key));
        return rawGet.call(this, key);
    };
    proto.setItem = function (key, value) {
        if (shouldNamespace(key)) return rawSet.call(this, rewrite(key), value);
        return rawSet.call(this, key, value);
    };
    proto.removeItem = function (key) {
        if (shouldNamespace(key)) return rawRemove.call(this, rewrite(key));
        return rawRemove.call(this, key);
    };

    installed = true;
}

export function setUserNamespace(ns) {
    currentNamespace = ns ? String(ns).replace(/[^a-zA-Z0-9@._-]/g, '_') : null;
}

export function getUserNamespace() {
    return currentNamespace;
}
