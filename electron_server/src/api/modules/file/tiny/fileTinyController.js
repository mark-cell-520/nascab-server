const ResponseUtil = require('../../../apiUtils/responseUtil');
const fileService = require('../core/fileService');
const fs = require('fs');

async function getTiny(req, res) {
  // console.log('tiny tiny', req.query.path, req.query.size);
  try {
    const { path: filePath, size } = req.query;
    if (!filePath) return ResponseUtil.error(req, res, 'file.INVALID_PATH', 400);
    const targetPath = await fileService.getTinyImgByPath(filePath, size);
    if (fs.existsSync(targetPath)) {
      return await res.sendFile(targetPath);
    } else {
      return res.sendStatus(404);
    }
  } catch (err) {
    // NOT_FILE：传进来的是目录（文件树给目录也要一张缩略图）。目录没有缩略图，
    // 回 404 让前端显示文件夹图标即可；原先会掉到 TINY_FAILED 记一条 500 错误日志。
    if (err.message !== 'file.TINY_PENDING' && err.message !== 'file.NOT_FILE') {
      console.log(err, req.query.path);
    }
    if (err.message === 'file.NOT_FOUND') return res.sendStatus(404);
    if (err.message === 'file.NOT_FILE') return res.sendStatus(404);
    if (err.message === 'file.TINY_PENDING') return res.status(202).set('Retry-After', '2').end();
    if (err.message === 'file.UNSUPPORTED_TYPE') return res.sendStatus(415);
    return ResponseUtil.error(req, res, 'file.TINY_FAILED', 500, { error: err.message });
  }
}

module.exports = {
  getTiny,
};
