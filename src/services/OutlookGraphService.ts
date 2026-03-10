/**
 * OutlookGraphService
 * 
 * A service module for interacting with Microsoft Graph API for Outlook Mail.
 * 
 * Endpoints used:
 * - reply: POST /me/messages/{id}/reply
 * - replyAll: POST /me/messages/{id}/replyAll
 * - forward: POST /me/messages/{id}/forward
 * - sendMail: POST /me/sendMail
 * - moveToArchive: POST /me/messages/{id}/move
 * - deleteMessage: DELETE /me/messages/{id}
 * - markAsRead: PATCH /me/messages/{id}
 */

export class OutlookGraphService {
  /**
   * Helper to make API calls to the local backend proxy
   */
  private static async apiCall(endpoint: string, method: string, body?: any) {
    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      return await response.json().catch(() => ({ success: true }));
    } catch (error: any) {
      console.error(`OutlookGraphService Error [${method} ${endpoint}]:`, error.message);
      throw error;
    }
  }

  /**
   * Reply to a message
   * Endpoint: POST /me/messages/{id}/reply
   */
  static async reply(messageId: string, comment: string) {
    return this.apiCall('/api/mail/reply', 'POST', {
      messageId,
      comment,
      action: 'reply'
    });
  }

  /**
   * Reply all to a message
   * Endpoint: POST /me/messages/{id}/replyAll
   */
  static async replyAll(messageId: string, comment: string) {
    return this.apiCall('/api/mail/reply', 'POST', {
      messageId,
      comment,
      action: 'replyAll'
    });
  }

  /**
   * Forward a message
   * Endpoint: POST /me/messages/{id}/forward
   */
  static async forward(messageId: string, comment: string, toRecipients: string[]) {
    return this.apiCall('/api/mail/reply', 'POST', {
      messageId,
      comment,
      action: 'forward',
      toRecipients: toRecipients.map(email => ({ emailAddress: { address: email } }))
    });
  }

  /**
   * Send a new email
   * Endpoint: POST /me/sendMail
   */
  static async sendMail(subject: string, content: string, toRecipients: string[]) {
    return this.apiCall('/api/mail/send', 'POST', {
      message: {
        subject,
        body: { contentType: 'Text', content },
        toRecipients: toRecipients.map(email => ({ emailAddress: { address: email } }))
      }
    });
  }

  /**
   * Move a message to the archive folder
   * Endpoint: POST /me/messages/{id}/move
   */
  static async moveToArchive(messageId: string) {
    return this.apiCall(`/api/mail/message/${messageId}/move`, 'POST', {
      destinationId: 'archive'
    });
  }

  /**
   * Soft delete a message (moves to Deleted Items)
   * Endpoint: DELETE /me/messages/{id}
   */
  static async deleteMessage(messageId: string) {
    // We need to add this endpoint to the server.ts
    return this.apiCall(`/api/mail/message/${messageId}`, 'DELETE');
  }

  /**
   * Mark a message as read or unread
   * Endpoint: PATCH /me/messages/{id}
   */
  static async markAsRead(messageId: string, isRead: boolean) {
    return this.apiCall(`/api/mail/message/${messageId}`, 'PATCH', {
      isRead
    });
  }
}
