const ResponseUtil = require('../../../apiUtils/responseUtil');
const Logger = require('../../../../utils/logger');
const { getUserLanguage } = require('../../../../utils/i18nUtil');
const AppAiService = require('./appAiService');
const photoTimeLineService = require('../timeline/photoTimeLineService');
const userUtil = require('../../../../utils/userUtil');

class AppAiController {
  async overview(req, res) {
    try {
      const locale = getUserLanguage(req);
      let validPaths;
      if (req.user && !userUtil.isAdmin(req.user)) {
        const validPathsRaw = await photoTimeLineService.getValidPaths(req.user);
        validPaths = (validPathsRaw || []).map(p => (p ? String(p) : '')).filter(Boolean);
      }
      const service = new AppAiService(req.dbPhoto);
      const result = await service.getOverview({
        ...(req.body || {}),
        ...(validPaths !== undefined ? { validPaths } : {}),
        // locale 必须是服务端权威：getUserLanguage 从 token / Accept-Language 推导，
        // 放在 body 展开之后，否则客户端带一个过期的 locale 就能让场景名称串语言。
        locale,
      });
      return ResponseUtil.success(req, res, result, 'common.SUCCESS', 200);
    } catch (e) {
      Logger.error(`[app_ai/overview] failed: ${e && e.message ? e.message : e}`);
      return ResponseUtil.error(req, res, 'common.ERROR', 500);
    }
  }
}

module.exports = new AppAiController();
