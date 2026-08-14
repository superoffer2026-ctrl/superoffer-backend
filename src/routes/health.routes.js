/**
 * Health routes.
 *
 * A routes file only maps URLs to controller functions. It contains no logic
 * and no database access — that is Rule 1 and Rule 2 of this project.
 *
 * Mounted at /api/v1/health in src/app.js, so the '/' below means the full
 * path GET /api/v1/health.
 */
const express = require('express');
const { getHealth } = require('../controllers/health.controller');

const router = express.Router();

router.get('/', getHealth);

module.exports = router;
