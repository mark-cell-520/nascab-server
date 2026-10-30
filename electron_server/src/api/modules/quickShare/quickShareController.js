const fs = require('fs');
const path = require('path');
const ResponseUtil = require('../../apiUtils/responseUtil');
const { QuickShareService } = require('./quickShareService');
const { hasPermission } = require('../../../utils/permissionUtil');
const FileUtil = require('../../../utils/fileUtil');
const tableConfig = require('../../../db/table/tableConfig');
const nascabAccountUtil = require('../service/utils/nascabAccountUtil');

class QuickShareController {
  async list(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const service = new QuickShareService(req.dbMain);
      let list = await service.listByUid(uid);
      // 过滤隐藏文件/文件夹（路径 basename 以 . 开头）
      list = (list || []).filter(item => {
        const p = item && item.path;
        if (!p || typeof p !== 'string') return false;
        const base = path.basename(p);
        return !FileUtil.isHideFile(base);
      });

      let pairCode = '';
      try {
        const enabled = await tableConfig.getP2pRemoteAccessEnabled();
        if (enabled === true) {
          const accessToken = await nascabAccountUtil.getStoredAccessToken(req.dbMain, tableConfig).catch(() => '');
          const refreshToken = accessToken ? '' : await nascabAccountUtil.getStoredRefreshToken(req.dbMain, tableConfig).catch(() => '');
          const loggedIn = !!(accessToken || refreshToken);
          if (loggedIn) {
            pairCode = await nascabAccountUtil.getDecryptedConfigValue(req.dbMain, tableConfig, nascabAccountUtil.NASCAB_KEYS.p2pPairCode).catch(() => '');
          }
        }
      } catch (_) {}

      return ResponseUtil.success(req, res, { items: list, pairCode }, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? String(e.message) : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 500;
      return ResponseUtil.error(req, res, msgKey, statusCode);
    }
  }

  async create(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
      if (!rawPath) return ResponseUtil.error(req, res, 'quickShare.INVALID_PATH', 400);
      const pwd = typeof body.pwd === 'string' ? body.pwd.trim() : '';
      if (!pwd) return ResponseUtil.error(req, res, 'quickShare.PASSWORD_REQUIRED', 400);

      const resolved = path.resolve(rawPath);
      // 快速分享是把一个目录连口令一起暴露到公网（还可以配成永不过期），所以分享
      // 根目录不能落在系统关键路径上：这里是全项目唯一一处把 isProtectedPath 注掉
      // 的地方，其余所有涉及路径的控制器（file/book/video/music/photo/fileBackup/
      // fileServer…）都有这道检查。hasPermission 只能证明「这个账号有权看」，
      // 证明不了「适合公开分享」——管理员账号把 /etc、/root 设成分享根目录，
      // 泄露面就从「登录后可见」变成「互联网上凭口令可见」。
      if (FileUtil.isProtectedPath(resolved)) {
        return ResponseUtil.error(req, res, 'quickShare.INVALID_PATH', 400);
      }
      try {
        await fs.promises.stat(resolved);
      } catch (_) {
        return ResponseUtil.error(req, res, 'quickShare.PATH_NOT_FOUND', 404);
      }

      const canView = await hasPermission(req.dbMain, req.user, ['download', 'view'], resolved);
      if (!canView) return ResponseUtil.forbidden(req, res);

      const service = new QuickShareService(req.dbMain);
      const created = await service.create({
        uid,
        rawPath: resolved,
        pwd,
        remark: body.remark,
        durationValue: body.durationValue ?? body.duration,
        durationUnit: body.durationUnit ?? body.unit,
        noLimit: body.noLimit === true || body.noExpire === true,
      });

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      // 静态挂载点是 /quickshare（见 app.js），不是 /web/quickshare。
      // 走反代子路径部署时 nginx 不转发 X-Forwarded-Prefix，服务端拿不到前缀，
      // 故这里只给根路径形态；客户端另用 webBasePathPrefix() 自行拼接子路径。
      const shareUrl = `${baseUrl}/quickshare/index.html?qt=${encodeURIComponent(created.token)}`;

      return ResponseUtil.success(
        req,
        res,
        {
          ...created,
          shareUrl,
        },
        'quickShare.CREATE_SUCCESS',
        201
      );
    } catch (e) {
      const msgKey = e && e.message ? String(e.message) : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 500;
      return ResponseUtil.error(req, res, msgKey, statusCode, { error: e && e.message ? String(e.message) : String(e) });
    }
  }

  async remove(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const body = req.body || {};
      const id = body.id ?? body.shareId ?? body.quickShareId;
      const service = new QuickShareService(req.dbMain);
      const result = await service.deleteById({ uid, id });
      if (!result.deleted) return ResponseUtil.error(req, res, 'quickShare.NOT_FOUND', 404);
      return ResponseUtil.success(req, res, result, 'quickShare.DELETE_SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? String(e.message) : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 500;
      return ResponseUtil.error(req, res, msgKey, statusCode);
    }
  }

  async cleanExpired(req, res) {
    try {
      const uid = req.user && req.user.id ? Number(req.user.id) : 0;
      if (!uid) return ResponseUtil.unauthorized(req, res);

      const service = new QuickShareService(req.dbMain);
      const result = await service.deleteExpiredByUid(uid);
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (e) {
      const msgKey = e && e.message ? String(e.message) : 'common.ERROR';
      const statusCode = e && e.statusCode ? Number(e.statusCode) : 500;
      return ResponseUtil.error(req, res, msgKey, statusCode);
    }
  }
}

module.exports = new QuickShareController();
