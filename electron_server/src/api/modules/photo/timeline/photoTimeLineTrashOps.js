const knexUtil = require('../../../../db/knexUtil');
const dbUtil = require('../../../../db/dbUtil');
const path = require('path');
const Logger = require('../../../../utils/logger');
const tableFileLog = require('../../../../db/table/tableFileLog');
const { hasPermission } = require('../../../../utils/permissionUtil');
const FileUtil = require('../../../../utils/fileUtil');
const userUtil = require('../../../../utils/userUtil');
const { applyPathPrefixFilter } = require('./photoPathQueryUtil');
const { isPathInRoot } = require('../../../../utils/appAccessScopeUtil');

const TRASH_DEFAULT_SORT_FIELD = 'in_trash_time';
const TRASH_PAGE_SIZE_DEFAULT = 20;
const TRASH_PAGE_SIZE_MAX = 200;

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

function paramError() {
  const err = new Error('common.PARAM_ERROR');
  err.statusCode = 400;
  return err;
}

function notFoundError() {
  const err = new Error('common.NOT_FOUND');
  err.statusCode = 404;
  return err;
}

function forbiddenError() {
  const err = new Error('auth.PERMISSION_DENIED');
  err.statusCode = 403;
  return err;
}

// 删文件 + 写文件日志。抽出来是因为 deleteFromTrash / emptyTrash 原来是
// 先 knex.del() 再 deleteEntries：文件删除一旦失败（回收站命令缺失、目录不可写、
// 进程被杀），索引行已经没了，照片从回收站里消失而文件还躺在磁盘上，
// 且因为索引行没了，再也不会有人去动它——静默孤儿文件。
// 现在一律先删物理文件、成功后再删索引行；失败时至少留着索引行，
// 重新扫一次库就能把这个文件重新管起来。
async function removeFilesAndLog(fileService, knex, user, pathsToDelete, recycle) {
  if (!pathsToDelete || pathsToDelete.length === 0) return;
  await fileService.deleteEntries(pathsToDelete, recycle);
  const uid = user && user.id;
  await fileService.addFileLog(uid, tableFileLog.TYPE_DELETE, pathsToDelete, null, tableFileLog.STATE_SUCCESS, recycle ? 'RECYCLE' : 'DELETE');
}

function createTrashOps({ getKnex, getValidPaths, indexFields }) {
  // 回收站列表允许客户端指定排序的列。原来是
  //   query.orderBy(`photo_index.${params.sortField}`, order)
  // 把字符串直接拼进 SQL：sortField 传 bogus_col 整条语句就报 no such column，
  // 而 controller 的 catch 又把 error.message 原样回给前端——响应体里连
  // select 语句和宿主的绝对照片源路径一起漏了出去。更阴的是 /boot/照片 这类
  // 中文目录名会让 responseUtil 的"含中文即人话"白名单把整段 SQL 放行。
  // 这里按真实列名收口：不认识的字段退回默认排序，不再有能炸掉查询的输入。
  const trashSortFields = new Set([...indexFields, TRASH_DEFAULT_SORT_FIELD, 'mtime', 'ctime', 'create_time', 'width', 'height']);

  async function batchTrash(ids, in_trash, user) {
    // 原来是 `if (!ids || ids.length === 0) return;`：空数组直接静默返回，
    // 接口照样回"照片已成功放入回收站"。调用方（时间轴多选删除、相似照片去重）
    // 会把这个成功当成"已经放进回收站了"，于是把选中项从内存里抹掉，
    // 用户看到照片"消失"了，回收站里却没有，原位置也没有。
    if (!Array.isArray(ids) || ids.length === 0) throw paramError();

    const knex = getKnex();
    let idsToUpdate = ids;

    if (in_trash && user && !userUtil.isAdmin(user)) {
      const mainKnex = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
      const rows = await knex('photo_index').whereIn('id', ids).select('id', 'path', 'filename');
      const allowedIds = [];
      for (const row of rows) {
        const fullPath = path.join(row.path, row.filename);
        if (FileUtil.isProtectedPath(fullPath)) continue;
        const canDelete = await hasPermission(mainKnex, user, 'delete', fullPath);
        if (canDelete) allowedIds.push(row.id);
      }
      if (ids.length > 0 && allowedIds.length === 0) {
        throw forbiddenError();
      }
      idsToUpdate = allowedIds;
      if (idsToUpdate.length === 0) return;
    }

    // 原来完全不看有没有命中：ids 全是查不到的 id（照片已被别人删掉、
    // 或传了相册/收藏夹的 id）时 update 影响 0 行，接口照样回成功。
    const hit = await knex('photo_index').whereIn('id', idsToUpdate).first('id');
    if (!hit) throw notFoundError();

    const updateData = {
      in_trash: in_trash ? 1 : 0,
    };

    if (in_trash) {
      updateData.in_trash_time = new Date();
    }

    await knex('photo_index').whereIn('id', idsToUpdate).update(updateData);
  }

  async function getTrashPhotoList(params, user) {
    const validPaths = await getValidPaths(user);
    if (validPaths.length === 0) {
      return { list: [], total: 0 };
    }

    const knex = getKnex();
    const query = knex('photo_index').where('photo_index.is_file', 1).where('photo_index.in_trash', 1);

    applyPathPrefixFilter(query, 'photo_index.path', validPaths);

    if (params.search) {
      const search = String(params.search || '').trim();
      if (search) {
        query.where(builder => {
          builder.where('photo_index.path', 'like', `%${search}%`).orWhere('photo_index.filename', 'like', `%${search}%`);
        });
      }
    }

    if (params.fileType) {
      if (params.fileType === 'photo') {
        query.where('photo_index.type', 1);
      } else if (params.fileType === 'video') {
        query.where('photo_index.type', 2);
      } else if (params.fileType === 'livephoto') {
        query.where('photo_index.is_lvp', 1);
      }
    }

    const rawSortField = params.sortField ? String(params.sortField).trim() : '';
    const sortField = trashSortFields.has(rawSortField) ? rawSortField : TRASH_DEFAULT_SORT_FIELD;
    if (rawSortField && sortField !== rawSortField) {
      Logger.warn(`[photo/trash/list] 未知排序字段 ${rawSortField}，退回 ${TRASH_DEFAULT_SORT_FIELD}`);
    }
    const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc';
    query.orderBy(`photo_index.${sortField}`, sortOrder);

    // 原来是 `const page = params.page || 1`：page='abc' 时 offset 变成 NaN，
    // knex 把它绑成 NULL，SQLite 直接报错——又是一次能把 SQL 原文带回前端的 500。
    // pageSize 同理，而且原来没有任何上限，传 pageSize=100000 会把整表捞进内存。
    const page = toPositiveInt(params.page, 1);
    const pageSize = Math.min(toPositiveInt(params.pageSize, TRASH_PAGE_SIZE_DEFAULT), TRASH_PAGE_SIZE_MAX);
    const offset = (page - 1) * pageSize;

    const totalQuery = query.clone();
    const total = await totalQuery.count('* as count');

    const selectFields = indexFields.map(f => `photo_index.${f}`);
    query.select([...selectFields, 'photo_index.in_trash_time']);
    query.limit(pageSize).offset(offset);

    const list = await query;
    const result = list.map(item => ({
      ...item,
      fullpath: path.join(item.path, item.filename),
    }));

    return {
      list: result,
      total: total[0].count,
    };
  }

  async function deleteFromTrash(ids, recycle = false, user, options = {}) {
    // 原来是 `if (!ids || ids.length === 0) return;`：空数组静默返回，
    // 接口回"照片已成功从回收站删除"，用户以为清掉了，其实什么都没做。
    if (!Array.isArray(ids) || ids.length === 0) throw paramError();

    const knex = getKnex();
    const mainKnex = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
    const fileService = require('../../file/core/fileService');
    const { deleteLivePhotoFile = 0, deleteRawFile = 0 } = options;

    const filesToDelete = await knex('photo_index').whereIn('id', ids).where('in_trash', 1).select('id', 'path', 'filename', 'live_filename', 'raw_filename');

    // ids 全都对不上回收站里的行（传了不在回收站里的照片 id、或已被别人删掉）：
    // 原来照样走到 knex.del()——那一条 del 用的是原始 ids、没有 in_trash 条件，
    // 于是这些"不在回收站里"的照片的索引行被删掉了，文件却留在磁盘上没人管。
    if (filesToDelete.length === 0) throw notFoundError();

    if (user && !userUtil.isAdmin(user) && filesToDelete.length > 0) {
      for (const file of filesToDelete) {
        const fullPath = path.join(file.path, file.filename);
        if (FileUtil.isProtectedPath(fullPath)) {
          throw forbiddenError();
        }
        const canDelete = await hasPermission(mainKnex, user, 'delete', fullPath);
        if (!canDelete) {
          throw forbiddenError();
        }
      }
    }

    const pathsToDelete = [];
    const idsToDelete = [];
    for (const file of filesToDelete) {
      const fullPath = path.join(file.path, file.filename);

      if (FileUtil.isProtectedPath(fullPath)) {
        Logger.warn(`Skipping protected file: ${fullPath}`);
        continue;
      }

      const canDelete = await hasPermission(mainKnex, user, 'delete', fullPath);
      if (!canDelete) {
        Logger.warn(`Skipping file due to permission: ${fullPath}`);
        continue;
      }

      pathsToDelete.push(fullPath);
      // 只有真的会去删文件的那些行，索引行才跟着删。
      // 原来是 `whereIn('id', ids)` 一刀切：被跳过的文件索引行也没了，
      // 文件还在磁盘上，但回收站里再也看不到它。
      idsToDelete.push(file.id);

      if (deleteLivePhotoFile && file.live_filename) {
        const liveFullPath = path.join(file.path, file.live_filename);
        if (!FileUtil.isProtectedPath(liveFullPath) && (await hasPermission(mainKnex, user, 'delete', liveFullPath))) {
          pathsToDelete.push(liveFullPath);
        }
      }

      if (deleteRawFile && file.raw_filename) {
        const rawFullPath = path.join(file.path, file.raw_filename);
        if (!FileUtil.isProtectedPath(rawFullPath) && (await hasPermission(mainKnex, user, 'delete', rawFullPath))) {
          pathsToDelete.push(rawFullPath);
        }
      }
    }

    // 有行但一行都不许删：不让接口回成功——那等于告诉用户"删掉了"，
    // 而回收站里一样东西都没少。
    if (pathsToDelete.length === 0) throw forbiddenError();

    await removeFilesAndLog(fileService, knex, user, pathsToDelete, recycle);

    await knex('photo_index').whereIn('id', idsToDelete).where('in_trash', 1).del();
  }

  async function restoreFromTrash(ids, user) {
    if (!Array.isArray(ids) || ids.length === 0) throw paramError();

    const knex = getKnex();

    const rows = await knex('photo_index').whereIn('id', ids).where('in_trash', 1).select('id', 'path', 'filename');
    if (rows.length === 0) throw notFoundError();

    let idsToRestore = rows.map(r => r.id);

    // 原来这个函数既不收 user 也不看 validPaths：拿到任意登录用户的 token，
    // 就能把别人照片源里的照片恢复出来——同一个模块的 restoreAllFromTrash 和
    // deleteFromTrash 都按 validPaths 收了口，就这里漏了。
    // 恢复只需要"看得见"，所以按 getValidPaths（view 权限推导出来的路径）过滤。
    if (user && !userUtil.isAdmin(user)) {
      const validPaths = await getValidPaths(user);
      const allowedIds = [];
      for (const row of rows) {
        const fullPath = path.join(row.path, row.filename);
        if (FileUtil.isProtectedPath(fullPath)) continue;
        if (!validPaths.some(root => isPathInRoot(fullPath, root))) continue;
        allowedIds.push(row.id);
      }
      if (allowedIds.length === 0) throw forbiddenError();
      idsToRestore = allowedIds;
    }

    await knex('photo_index').whereIn('id', idsToRestore).where('in_trash', 1).update({
      in_trash: 0,
      in_trash_time: null,
    });
  }

  async function restoreAllFromTrash(user) {
    const validPaths = await getValidPaths(user);
    if (validPaths.length === 0) return;

    const knex = getKnex();
    const query = knex('photo_index').where('is_file', 1).where('in_trash', 1);
    applyPathPrefixFilter(query, 'path', validPaths);

    await query.update({
      in_trash: 0,
      in_trash_time: null,
    });
  }

  async function emptyTrash(user, recycle = false, options = {}) {
    const validPaths = await getValidPaths(user);

    const knex = getKnex();
    const mainKnex = knexUtil.getInstance(dbUtil.DB_PATHS.MAIN_DB);
    const fileService = require('../../file/core/fileService');
    const { deleteLivePhotoFile = 0, deleteRawFile = 0 } = options;

    // 原来是 `if (validPaths.length === 0) return;`。applyPathPrefixFilter 传空列表时
    // 会 emit whereRaw('1 = 0')，本来就查不到任何行，提前返回只是让行为取决于
    // validPaths 是不是空数组而不是取决于数据；这里去掉提前返回，走同一条查询路径。
    const query = knex('photo_index').where('is_file', 1).where('in_trash', 1);
    applyPathPrefixFilter(query, 'path', validPaths);

    const filesToDelete = await query.select('id', 'path', 'filename', 'live_filename', 'raw_filename');

    const pathsToDelete = [];
    const idsToDelete = [];
    for (const file of filesToDelete) {
      const fullPath = path.join(file.path, file.filename);

      if (FileUtil.isProtectedPath(fullPath)) {
        Logger.warn(`Skipping protected file: ${fullPath}`);
        continue;
      }

      const canDelete = await hasPermission(mainKnex, user, 'delete', fullPath);
      if (!canDelete) {
        Logger.warn(`Skipping file due to permission: ${fullPath}`);
        continue;
      }

      pathsToDelete.push(fullPath);
      idsToDelete.push(file.id);

      if (deleteLivePhotoFile && file.live_filename) {
        const liveFullPath = path.join(file.path, file.live_filename);
        if (!FileUtil.isProtectedPath(liveFullPath) && (await hasPermission(mainKnex, user, 'delete', liveFullPath))) {
          pathsToDelete.push(liveFullPath);
        }
      }

      if (deleteRawFile && file.raw_filename) {
        const rawFullPath = path.join(file.path, file.raw_filename);
        if (!FileUtil.isProtectedPath(rawFullPath) && (await hasPermission(mainKnex, user, 'delete', rawFullPath))) {
          pathsToDelete.push(rawFullPath);
        }
      }
    }

    // 非管理员看得见文件但一行都不许删：不让接口回成功——回收站会显示"已清空"，
    // 而所有文件都还在。
    if (user && !userUtil.isAdmin(user) && filesToDelete.length > 0 && idsToDelete.length === 0) {
      throw forbiddenError();
    }

    // 先删物理文件再删索引行。原来是 `await query.del()` 先删行，
    // 而且删的是 applyPathPrefixFilter 选出来的全部行——包括刚被
    // 权限检查跳过的那些：文件还在磁盘上，索引行已经没了，
    // 回收站里再也看不到它，再也不会有人去删它。
    await removeFilesAndLog(fileService, knex, user, pathsToDelete, recycle);

    if (idsToDelete.length > 0) {
      await knex('photo_index').whereIn('id', idsToDelete).where('in_trash', 1).del();
    }
  }

  return {
    batchTrash,
    getTrashPhotoList,
    deleteFromTrash,
    restoreFromTrash,
    restoreAllFromTrash,
    emptyTrash,
  };
}

module.exports = { createTrashOps };
