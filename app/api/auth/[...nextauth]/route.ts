import NextAuth, { DefaultSession, Session, CallbacksOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// Add this type declaration
declare module "next-auth" {
  interface Session extends DefaultSession {
    accessToken?: string;
  }
  interface JWT {
    accessToken?: string;
  }
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token as string;
      }
      return token;
    },
    async session({ session, token }) {
      (session as Session & { accessToken: string }).accessToken = token.accessToken as string;
      return session;
    },
  } satisfies Partial<CallbacksOptions>,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
