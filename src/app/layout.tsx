import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alpaca Trade Automation',
  description: 'Automated Stock & Crypto Trading with Alpaca API, Sentiment Engine & Cloudflare Edge Execution',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased selection:bg-blue-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
