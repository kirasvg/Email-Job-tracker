import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { lastFetchTime } = await request.json();
  const afterDate = new Date(lastFetchTime).toISOString();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `subject:(job OR application OR applied OR position OR opportunity OR software) after:${afterDate}`,
      maxResults: 1000,
    });

    const messages = response.data.messages || [];
    if (messages.length === 0) {
      return NextResponse.json([]);
    }

    const messageDetails = await Promise.all(
      messages.map(async (message) => {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'full',
        });
        return extractEmailInfo(details);
      })
    );

    return NextResponse.json(messageDetails);
  } catch (error) {
    console.error('Error details:', error);
    return NextResponse.json({ error: 'Failed to fetch new emails' }, { status: 500 });
  }
} 