import type { Metadata } from "next";
import { Gowun_Dodum, Jua, Geist_Mono } from "next/font/google";
import "./globals.css";

// 둥근모꼴 느낌 - 본문용 (부드러운 고딕)
const gowunDodum = Gowun_Dodum({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-gowun",
  display: "swap",
});

// 둥근모꼴 느낌 - 타이틀/포인트용
const jua = Jua({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-jua",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DISHOUSE — 디스코드 집",
  description: "Discord 서버를 집으로 표현한 2D 인터랙티브 커뮤니티",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${gowunDodum.variable} ${jua.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#fafaf9]">{children}</body>
    </html>
  );
}
