const { ServiceError } = require('./errors');

function bearerAuthorization(value) {
    const match = typeof value === 'string' && value.match(/^Bearer +(\S+)$/i);
    if (!match) throw new ServiceError(401, 'UNAUTHORIZED', 'A Bearer token is required');
    return `Bearer ${match[1]}`;
}

function createSportsClient({ sportsServiceUrl, timeoutMs = 5000, fetchImpl = globalThis.fetch }) {
    async function get(path, authorization) {
        try {
            const response = await fetchImpl(`${sportsServiceUrl}${path}`, {
                method: 'GET', headers: { Accept: 'application/json', Authorization: authorization },
                signal: AbortSignal.timeout(timeoutMs), redirect: 'manual'
            });
            if (response.status !== 200) {
                await response.body?.cancel();
                if (response.status === 401) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired token');
                if (response.status === 403) throw new ServiceError(403, 'FORBIDDEN', 'Access denied by sportsService');
                if (response.status === 404 && path !== '/users/me') throw new ServiceError(404, 'USER_NOT_FOUND', 'User not found');
                throw new ServiceError(response.status >= 500 ? 503 : 502, 'AUTH_SERVICE_UNAVAILABLE', 'Authentication service unavailable');
            }
            return await response.json();
        } catch (error) {
            if (error instanceof ServiceError) throw error;
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                throw new ServiceError(504, 'AUTH_TIMEOUT', 'Authentication service timed out');
            }
            if (error instanceof SyntaxError) throw new ServiceError(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid authentication service response');
            throw new ServiceError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Could not contact the authentication service');
        }
    }

    function validIdentity(user) {
        return user && Number.isSafeInteger(user.id) && user.id > 0 && ['coach', 'player', 'fan'].includes(user.role);
    }

    async function getUser(authorization) {
        const user = await get('/users/me', authorization);
        if (user && user.is_active === false) throw new ServiceError(403, 'FORBIDDEN', 'This account is inactive');
        if (!validIdentity(user) || typeof user.name !== 'string' || !user.name.trim() || user.is_active !== true) {
            throw new ServiceError(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid authentication service response');
        }
        return { id: user.id, name: user.name, role: user.role };
    }

    async function getPublicProfile(authorization, userId) {
        const profile = await get(`/users/${userId}/public`, authorization);
        if (!validIdentity(profile) || profile.id !== userId ||
            !(profile.username === null || typeof profile.username === 'string') ||
            !(profile.avatar_media_id === null || (Number.isSafeInteger(profile.avatar_media_id) && profile.avatar_media_id > 0)) ||
            !['SELF', 'NONE', 'FRIENDS', 'PENDING_SENT', 'PENDING_RECEIVED'].includes(profile.friendship_status)) {
            throw new ServiceError(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid public profile response');
        }
        return {
            id: profile.id, username: profile.username, role: profile.role,
            avatar_media_id: profile.avatar_media_id, friendship_status: profile.friendship_status
        };
    }

    async function assertFriend(authorization, userId) {
        const profile = await getPublicProfile(authorization, userId);
        if (profile.friendship_status !== 'FRIENDS') throw new ServiceError(403, 'NOT_FRIENDS', 'You can only chat with current friends');
        return profile;
    }

    return { getUser, getPublicProfile, assertFriend };
}

module.exports = { bearerAuthorization, createSportsClient };
