import {Router} from 'express';
import got from 'got';
import config from '../../bot/Config.js';

const router = Router();

/**
 * Build the Discord OAuth2 authorization URL
 * @returns {string}
 */
function getOAuthUrl() {
    const webConfig = config.data.webui ?? {};
    const clientId = webConfig.clientId ?? '';
    const redirectUri = webConfig.redirectUri ?? '';
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify guilds',
    });
    return `https://discord.com/api/oauth2/authorize?${params}`;
}

/**
 * Exchange auth code for access token
 * @param {string} code
 * @returns {Promise<object>}
 */
async function exchangeCode(code) {
    const webConfig = config.data.webui ?? {};
    const response = await got.post('https://discord.com/api/oauth2/token', {
        form: {
            client_id: webConfig.clientId ?? '',
            client_secret: webConfig.clientSecret ?? '',
            grant_type: 'authorization_code',
            code,
            redirect_uri: webConfig.redirectUri ?? '',
        },
    }).json();
    return response;
}

/**
 * Fetch Discord user info
 * @param {string} accessToken
 * @returns {Promise<object>}
 */
async function fetchUser(accessToken) {
    return got.get('https://discord.com/api/users/@me', {
        headers: {Authorization: `Bearer ${accessToken}`},
    }).json();
}

/**
 * Fetch guilds for a user
 * @param {string} accessToken
 * @returns {Promise<object[]>}
 */
async function fetchGuilds(accessToken) {
    return got.get('https://discord.com/api/users/@me/guilds', {
        headers: {Authorization: `Bearer ${accessToken}`},
    }).json();
}

router.get('/login', (_req, res) => {
    res.redirect(getOAuthUrl());
});

router.get('/callback', async (req, res) => {
    const {code} = req.query;
    if (!code) {
        return res.redirect('/?error=missing_code');
    }

    try {
        const tokenData = await exchangeCode(String(code));
        const [user, guilds] = await Promise.all([
            fetchUser(tokenData.access_token),
            fetchGuilds(tokenData.access_token),
        ]);

        req.session.user = {
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            accessToken: tokenData.access_token,
        };

        // Only expose guilds where user has Manage Guild permission (0x20)
        req.session.guilds = guilds.filter(g => (BigInt(g.permissions) & 0x20n) !== 0n);

        res.redirect('/dashboard');
    } catch (err) {
        console.error('[WebUI] OAuth2 authentication failed:', err.message);
        res.redirect('/?error=auth_failed');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

export default router;
