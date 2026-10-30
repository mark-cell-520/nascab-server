import 'package:get/get.dart';
import '../../../core/api/base_api_service.dart';

class MessageApiService extends BaseApiService {
  static MessageApiService get instance => Get.isRegistered<MessageApiService>()
      ? Get.find<MessageApiService>()
      : MessageApiService();

  Future<Map<String, dynamic>> getMessages({
    int page = 1,
    int pageSize = 20,
    int? level,
    String? keyword,
  }) async {
    final queryParams = <String, String>{
      'page': page.toString(),
      'pageSize': pageSize.toString(),
    };
    if (level != null) {
      queryParams['level'] = level.toString();
    }
    if (keyword != null && keyword.isNotEmpty) {
      queryParams['keyword'] = keyword;
    }

    final response = await apiGet<Map<String, dynamic>>(
      '/api/message/list',
      queryParams: queryParams,
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>> addMessage({
    String title = '',
    required String message,
    Map<String, dynamic>? action,
    int level = 0,
    int isPublic = 1,
  }) async {
    final response = await apiPost<Map<String, dynamic>>(
      '/api/message/add',
      body: {
        'title': title,
        'message': message,
        if (action != null) 'action': action,
        'level': level,
        'isPublic': isPublic,
      },
    );
    return response.data ?? {};
  }

  // 已读/删除/清空都会改服务端状态，调用方必须知道有没有成功：
  // 服务端现在会按属主鉴权（403）、按 level 过滤，失败时不能照旧改本地列表。
  Future<ApiResponse<Map<String, dynamic>>> markAsRead({int? messageId}) {
    return apiPost<Map<String, dynamic>>(
      '/api/message/markAsRead',
      body: {if (messageId != null) 'messageId': messageId},
    );
  }

  Future<ApiResponse<Map<String, dynamic>>> deleteMessage({
    required int messageId,
  }) {
    return apiPost<Map<String, dynamic>>(
      '/api/message/delete',
      body: {'messageId': messageId},
    );
  }

  Future<ApiResponse<Map<String, dynamic>>> clearMessages({int? level}) {
    return apiPost<Map<String, dynamic>>(
      '/api/message/clear',
      body: {if (level != null) 'level': level},
    );
  }

  Future<Map<String, dynamic>> getUnreadCount() async {
    final response = await apiGet<Map<String, dynamic>>(
      '/api/message/unreadCount',
    );
    return response.data ?? {};
  }
}
