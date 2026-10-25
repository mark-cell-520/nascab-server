const express = require('express');
const router = express.Router();
const { authenticateJWT, requireAdmin } = require('../../middleware/authMiddleware');
const consoleController = require('./consoleController');

/**
 * Web 控制台专用 API
 * 与桌面/移动客户端使用的业务 API 分开，只暴露「控制台页面」需要的信息，
 * 便于单独做权限与变更管理。
 */

// 登录页引导信息（产品名/版本），无需登录
router.get('/bootstrap', (req, res) => consoleController.getBootstrap(req, res));

// 控制台概览：设备信息 + 运行状态 + 硬件指标（普通登录用户即可查看）
router.get('/overview', authenticateJWT, (req, res) => consoleController.getOverview(req, res));

// 系统日志尾部查看（仅管理员）
router.get('/logs', authenticateJWT, requireAdmin, (req, res) => consoleController.getLogs(req, res));

module.exports = router;
