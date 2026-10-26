import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "안석주의 한 페이지",
  description: "안석주의 공개 소개와 패스키로 여는 비공개 공간입니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
