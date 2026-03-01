import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import {fileURLToPath} from 'url';
import path from 'path';
import crypto from 'node:crypto';
import config from '../bot/Config.js';
import authRouter from './routes/auth.js';
import apiRouter from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Rate limiter for auth and API routes (100 requests per 15 minutes per IP) */
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Attach a per-session CSRF token and expose it as a cookie for the frontend.
 * State-changing requests must send it back in the X-CSRF-Token header.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function csrfMiddleware(req, res, next) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    // Expose the token as a readable (non-HttpOnly) cookie so the JS frontend can send it back
    const secureCookies = (config.data.webui?.secure) ?? (process.env.NODE_ENV === 'production');
    res.cookie('XSRF-TOKEN', req.session.csrfToken, {sameSite: 'strict', secure: secureCookies});

    // Validate token on state-changing methods
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const token = req.headers['x-csrf-token'] ?? req.body?.['_csrf'];
        if (!token || token !== req.session.csrfToken) {
            return res.status(403).json({error: 'Invalid CSRF token'});
        }
    }
    next();
}

export class WebServer {
    /**
     * @type {import('express').Express}
     */
    #app;

    /**
     * @type {import('http').Server}
     */
    #server = null;

    #initialized = false;

    constructor() {
        this.#app = express();
    }

    /**
     * Configure middleware and routes
     */
    #setup() {
        const webConfig = config.data.webui ?? {};
        const secret = webConfig.sessionSecret;
        if (!secret) {
            console.warn('[WebUI] No sessionSecret configured - using insecure default. Set webui.sessionSecret in your config!');
        }
        // Default to secure cookies in production; allow override via config
        const secureCookies = webConfig.secure ?? (process.env.NODE_ENV === 'production');

        this.#app.use(express.json());
        this.#app.use(express.urlencoded({extended: false}));
        this.#app.use(session({
            secret: secret ?? 'modbot-web-secret-change-me',
            resave: false,
            saveUninitialized: false,
            cookie: {
                // sameSite: 'strict' provides CSRF protection; explicit token validation also applied via csrfMiddleware
                sameSite: 'strict',
                // secure cookies enforced in production; set webui.secure:true when using HTTPS
                secure: secureCookies,
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000,
            },
        }));

        this.#app.use(express.static(path.join(__dirname, 'public')));

        this.#app.use('/auth', limiter, authRouter);
        this.#app.use('/api', limiter, csrfMiddleware, apiRouter);

        this.#app.get('/{*path}', limiter, (_req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
    }

    /**
     * Start the web server
     * @returns {Promise<void>}
     */
    start() {
        if (!this.#initialized) {
            this.#setup();
            this.#initialized = true;
        }
        return new Promise((resolve, reject) => {
            const webConfig = config.data.webui ?? {};
            const port = webConfig.port ?? 8080;
            this.#server = this.#app.listen(port, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    /**
     * Stop the web server
     * @returns {Promise<void>}
     */
    stop() {
        return new Promise((resolve, reject) => {
            if (!this.#server) return resolve();
            this.#server.close(err => {
                if (err) return reject(err);
                resolve();
            });
        });
    }
}

export default new WebServer();
