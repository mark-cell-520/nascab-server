'use strict';
/**
 * 机器控制接口路由（/api/control）
 *
 * 与 /api/console（面向浏览器、走 JWT）分开：
 *   - 认证：一个长期控制令牌，见 controlAuth.js
 *   - 响应：稳定的 { ok, data, error }，不做国际化
 *   - 路径：服务端绝对路径
 *
 * 该 router 会被两处挂载：
 *   1. 主应用 app.js —— 与业务 API 同端口，便于反向代理统一暴露
 *   2. controlServer.js —— 独立监听地址/端口（默认 127.0.0.1:6792），
 *      给本机脚本/Agent 用，可以单独做防火墙策略
 */

const express = require('express');
const controlController = require('./controlController');
const { requireControlToken } = require('./controlAuth');

const router = express.Router();

// 公开探活：不需要令牌，用于发现与探针
router.get('/ping', (req, res) => controlController.ping(req, res));

// 以下全部需要控制令牌
router.use(requireControlToken);

router.get('/info', (req, res) => controlController.info(req, res));
router.get('/status', (req, res) => controlController.status(req, res));
router.get('/logs', (req, res) => controlController.logs(req, res));

// 共享目录
router.get('/shares', (req, res) => controlController.shares(req, res));
router.post('/shares', (req, res) => controlController.addShare(req, res));
router.post('/shares/remove', (req, res) => controlController.removeShare(req, res));

// 文件
router.get('/files', (req, res) => controlController.listFiles(req, res));
router.get('/files/stat', (req, res) => controlController.statFile(req, res));
router.get('/files/download', (req, res) => controlController.download(req, res));
router.post('/files/upload', (req, res) => controlController.upload(req, res));
router.post('/files/mkdir', (req, res) => controlController.mkdir(req, res));
router.post('/files/rename', (req, res) => controlController.rename(req, res));
router.post('/files/delete', (req, res) => controlController.deleteFiles(req, res));

// 下载器（Transmission）
router.get('/downloads', (req, res) => controlController.downloads(req, res));
router.post('/downloads/add', (req, res) => controlController.addDownload(req, res));
router.post('/downloads/action', (req, res) => controlController.downloadAction(req, res));

// 容器（Docker）
router.get('/docker/status', (req, res) => controlController.dockerStatus(req, res));
router.get('/docker/containers', (req, res) => controlController.dockerContainers(req, res));
router.get('/docker/images', (req, res) => controlController.dockerImages(req, res));
router.post('/docker/container', (req, res) => controlController.dockerContainerAction(req, res));

module.exports = router;
