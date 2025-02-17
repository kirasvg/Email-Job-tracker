import { google } from 'googleapis';

export async function getGmailMessages(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'subject:"job application" OR subject:"application confirmation"',
      maxResults: 1000,
    });

    const messages = response.data.messages || [];
    const messageDetails = await Promise.all(
      messages.map(async (message) => {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
        });
        return details.data;
      })
    );

    return messageDetails;
  } catch (error) {
    console.error('Error fetching Gmail messages:', error);
    throw error;
  }
} 