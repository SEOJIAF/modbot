import {Router} from 'express';
import got from 'got';
import GuildSettings from '../../settings/GuildSettings.js';
import BadWord from '../../database/BadWord.js';
import AutoResponse from '../../database/AutoResponse.js';
import Moderation from '../../database/Moderation.js';
import WhereParameter from '../../database/WhereParameter.js';
import config from '../../bot/Config.js';

const router = Router();

/**
 * Middleware: require authenticated session
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function requireAuth(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({error: 'Unauthorized'});
    }
    next();
}

/**
 * Middleware: require user has the guild in their guild list
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function requireGuildAccess(req, res, next) {
    const {guildId} = req.params;
    const guilds = req.session?.guilds ?? [];
    if (!guilds.find(g => g.id === guildId)) {
        return res.status(403).json({error: 'Forbidden'});
    }
    next();
}

router.use(requireAuth);

// ─── User & Guilds ────────────────────────────────────────────────────────────

router.get('/me', (req, res) => {
    const {id, username, avatar} = req.session.user;
    res.json({id, username, avatar});
});

router.get('/guilds', (req, res) => {
    res.json(req.session.guilds ?? []);
});

// ─── User Info ────────────────────────────────────────────────────────────────

router.get('/users/:userId', async (req, res) => {
    const {userId} = req.params;
    if (!/^\d{17,20}$/.test(userId)) {
        return res.status(400).json({error: 'Invalid user ID'});
    }
    try {
        const token = config.data.authToken;
        if (!token) return res.status(503).json({error: 'Service temporarily unavailable'});
        const user = await got.get(`https://discord.com/api/v10/users/${userId}`, {
            headers: {Authorization: `Bot ${token}`},
        }).json();
        res.json({id: user.id, username: user.username, avatar: user.avatar});
    } catch (err) {
        const status = err.response?.statusCode === 404 ? 404 : 502;
        res.status(status).json({error: status === 404 ? 'User not found' : 'Failed to fetch user'});
    }
});

// ─── Guild Settings ───────────────────────────────────────────────────────────

router.get('/guilds/:guildId/settings', requireGuildAccess, async (req, res) => {
    try {
        const settings = await GuildSettings.get(req.params.guildId);
        res.json(settings.getDataObject());
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

// ─── Moderations ──────────────────────────────────────────────────────────────

router.get('/guilds/:guildId/moderations', requireGuildAccess, async (req, res) => {
    try {
        const {guildId} = req.params;
        const {userId, action, limit = '50', offset = '0'} = req.query;

        const params = [new WhereParameter('guildid', guildId)];
        if (userId) params.push(new WhereParameter('userid', String(userId)));
        if (action) params.push(new WhereParameter('action', String(action)));

        const moderations = await Moderation.select(
            params,
            Math.min(parseInt(String(limit)) || 50, 100),
            false
        );

        // Paginate
        const start = parseInt(String(offset)) || 0;
        res.json(moderations.slice(start).map(m => ({
            id: m.id,
            userid: m.userid,
            action: m.action,
            created: m.created,
            value: m.value,
            expireTime: m.expireTime,
            reason: m.reason,
            comment: m.comment,
            moderator: m.moderator,
            active: m.active,
        })));
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

// ─── Bad Words ────────────────────────────────────────────────────────────────

router.get('/guilds/:guildId/badwords', requireGuildAccess, async (req, res) => {
    try {
        const items = await BadWord.getAll(req.params.guildId);
        res.json([...items.values()].map(bw => ({
            id: bw.id,
            trigger: bw.trigger,
            punishment: bw.punishment,
            response: bw.response,
            global: bw.global,
            channels: bw.channels,
            priority: bw.priority,
            enableVision: bw.enableVision,
            dm: bw.dm,
        })));
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

router.post('/guilds/:guildId/badwords', requireGuildAccess, async (req, res) => {
    try {
        const {triggerType, triggerContent, punishment, duration, response, priority, dm, global: isGlobal, channels} = req.body;
        const result = await BadWord.new(
            req.params.guildId,
            Boolean(isGlobal),
            Array.isArray(channels) ? channels : [],
            String(triggerType || 'include'),
            String(triggerContent || ''),
            response || null,
            punishment || 'none',
            duration ? parseInt(String(duration)) || null : null,
            priority !== undefined ? parseInt(String(priority)) || 0 : 0,
            dm || null,
            false,
        );
        if (!result.success) return res.status(400).json({error: result.message});
        const bw = result.badWord;
        res.status(201).json({id: bw.id, trigger: bw.trigger, punishment: bw.punishment,
            response: bw.response, global: bw.global, channels: bw.channels,
            priority: bw.priority, dm: bw.dm});
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

router.delete('/guilds/:guildId/badwords/:id', requireGuildAccess, async (req, res) => {
    try {
        const bw = await BadWord.getByID(req.params.id, req.params.guildId);
        if (!bw) return res.status(404).json({error: 'Not found'});
        await bw.delete();
        res.json({success: true});
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

router.post('/guilds/:guildId/badwords/bulk', requireGuildAccess, async (req, res) => {
    try {
        const {words, triggerType, punishment, duration, response, global: isGlobal, channels} = req.body;
        if (!Array.isArray(words) || words.length === 0) {
            return res.status(400).json({error: 'words must be a non-empty array'});
        }

        let created = 0;
        let failed = 0;
        const errors = [];

        for (const word of words) {
            const content = String(word).trim();
            if (!content) { failed++; continue; }
            const result = await BadWord.new(
                req.params.guildId,
                Boolean(isGlobal),
                Array.isArray(channels) ? channels : [],
                String(triggerType || 'include'),
                content,
                response || null,
                punishment || 'none',
                duration ? (Number.isNaN(parseInt(String(duration))) ? null : parseInt(String(duration))) : null,
                0,
                null,
                false,
            );
            if (result.success) {
                created++;
            } else {
                failed++;
                errors.push({word: content, error: result.message});
            }
        }

        res.status(201).json({created, failed, errors});
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

// ─── Auto Responses ───────────────────────────────────────────────────────────

router.get('/guilds/:guildId/responses', requireGuildAccess, async (req, res) => {
    try {
        const items = await AutoResponse.getAll(req.params.guildId);
        res.json([...items.values()].map(r => ({
            id: r.id,
            trigger: r.trigger,
            response: r.response,
            global: r.global,
            channels: r.channels,
            enableVision: r.enableVision,
        })));
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

router.post('/guilds/:guildId/responses', requireGuildAccess, async (req, res) => {
    try {
        const {triggerType, triggerContent, response, global: isGlobal, channels} = req.body;
        const result = await AutoResponse.new(
            req.params.guildId,
            Boolean(isGlobal),
            Array.isArray(channels) ? channels : [],
            String(triggerType || 'include'),
            String(triggerContent || ''),
            String(response || ''),
            false,
        );
        if (!result.success) return res.status(400).json({error: result.message});
        const r = result.response;
        res.status(201).json({id: r.id, trigger: r.trigger, response: r.response,
            global: r.global, channels: r.channels});
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

router.delete('/guilds/:guildId/responses/:id', requireGuildAccess, async (req, res) => {
    try {
        const r = await AutoResponse.getByID(req.params.id, req.params.guildId);
        if (!r) return res.status(404).json({error: 'Not found'});
        await r.delete();
        res.json({success: true});
    } catch (err) {
        res.status(500).json({error: String(err.message)});
    }
});

export default router;
