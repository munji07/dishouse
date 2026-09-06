import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DISHOUSE — 디스코드 집",
  description: "Discord 서버를 집으로 표현한 2D 인터랙티브 커뮤니티",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-[#fafaf9]">{children}</body>
    </html>
  );
}
