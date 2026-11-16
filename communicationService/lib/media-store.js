const { randomBytes, createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { ServiceError } = require('./errors');

const TYPES = {
    'image/jpeg': { type: 'IMAGE', extension: 'jpg' },
    'image/png': { type: 'IMAGE', extension: 'png' },
    'image/webp': { type: 'IMAGE', extension: 'webp' },
    'video/mp4': { type: 'VIDEO', extension: 'mp4' },
    'video/webm': { type: 'VIDEO', extension: 'webm' }
};
const KEY = /^[a-f0-9]{32}$/;

async function createMediaStore({ root, imageMaxBytes = 10 * 1024 * 1024, videoMaxBytes = 50 * 1024 * 1024, findMessageById }) {
    const directory = resolve(root);
    const staging = join(directory, '.pending');
    await fs.mkdir(staging, { recursive: true });
    const { fileTypeFromFile } = await import('file-type');
    const paths = key => {
        if (!KEY.test(key)) throw new Error('Invalid internal media key');
        return { final: join(directory, key), part: join(staging, `${key}.part`), marker: join(staging, `${key}.json`) };
    };
    const unlink = path => fs.unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const cleanup = async key => {
        const path = paths(key);
        // Only paths for this newly staged upload are ever removed; never scan/delete
        // existing messages or arbitrary files in the media directory.
        await unlink(path.part); await unlink(path.final); await unlink(path.marker);
    };

    // A tiny durable marker bridges the filesystem/MongoDB crash boundary. On a
    // restart, clean only unfinished uploads created by this service. If MongoDB
    // cannot resolve an uncertain insert, retain the marker and file until recovery.
    for (const entry of await fs.readdir(staging, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[a-f0-9]{32}\.json$/.test(entry.name)) continue;
        const key = entry.name.slice(0, -5), path = paths(key);
        const marker = JSON.parse(await fs.readFile(path.marker, 'utf8'));
        if (marker.version !== 1 || !/^[a-f0-9]{24}$/.test(marker.messageId)) throw new Error('Invalid pending upload marker');
        const message = await findMessageById(marker.messageId);
        if (message?.media?.storageKey === key) { await unlink(path.part); await unlink(path.marker); }
        else await cleanup(key);
    }

    return {
        imageMaxBytes, videoMaxBytes,
        config: {
            image_max_bytes: imageMaxBytes, video_max_bytes: videoMaxBytes,
            image_types: Object.keys(TYPES).filter(type => type.startsWith('image/')),
            video_types: Object.keys(TYPES).filter(type => type.startsWith('video/'))
        },
        async stage(part, messageId, signal, onCreated) {
            const key = randomBytes(16).toString('hex'), path = paths(key);
            await fs.writeFile(path.marker, JSON.stringify({ version: 1, messageId }), { flag: 'wx', mode: 0o600 });
            onCreated(key);
            let size = 0;
            const hash = createHash('sha256');
            const maximum = Math.max(imageMaxBytes, videoMaxBytes);
            const meter = new Transform({ transform(chunk, _encoding, done) {
                size += chunk.length;
                if (size > maximum) return done(new ServiceError(413, 'FILE_TOO_LARGE', 'The selected file exceeds the upload limit'));
                hash.update(chunk); done(null, chunk);
            } });
            await pipeline(part.file, meter, createWriteStream(path.part, { flags: 'wx', mode: 0o600 }), { signal });
            if (part.file.truncated) throw new ServiceError(413, 'FILE_TOO_LARGE', 'The selected file exceeds the upload limit');
            if (!size) throw new ServiceError(422, 'EMPTY_FILE', 'Empty files are not allowed');
            let detected;
            try { detected = await fileTypeFromFile(path.part); }
            catch { throw new ServiceError(415, 'INVALID_MEDIA', 'The file content is not a supported image or video'); }
            const format = TYPES[detected?.mime];
            if (!format) throw new ServiceError(415, 'INVALID_MEDIA', 'Use JPEG, PNG, WebP, MP4 or WebM files');
            if (part.mimetype && part.mimetype !== 'application/octet-stream' && part.mimetype !== detected.mime) {
                throw new ServiceError(415, 'INVALID_MEDIA', 'The file content does not match its declared format');
            }
            const limit = format.type === 'IMAGE' ? imageMaxBytes : videoMaxBytes;
            if (size > limit) throw new ServiceError(413, 'FILE_TOO_LARGE', `The ${format.type.toLowerCase()} exceeds the configured size limit`);
            await fs.rename(path.part, path.final);
            return { type: format.type, media: { storageKey: key, contentType: detected.mime, sizeBytes: size, sha256: hash.digest('hex') } };
        },
        async finalize(key) { await unlink(paths(key).marker); },
        cleanup,
        async open(media) {
            const path = paths(media.storageKey).final;
            const info = await fs.lstat(path);
            if (!info.isFile() || info.isSymbolicLink() || info.size !== media.sizeBytes || !TYPES[media.contentType]) throw new Error('Invalid stored media');
            return { path, size: info.size, contentType: media.contentType, extension: TYPES[media.contentType].extension };
        }
    };
}

function parseRange(value, size) {
    if (value === undefined) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) throw new ServiceError(416, 'INVALID_RANGE', 'Requested range is not available');
    let start, end;
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new ServiceError(416, 'INVALID_RANGE', 'Requested range is not available');
        start = Math.max(0, size - suffix); end = size - 1;
    } else {
        start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw new ServiceError(416, 'INVALID_RANGE', 'Requested range is not available');
    return { start, end: Math.min(end, size - 1) };
}

module.exports = { createMediaStore, parseRange };
