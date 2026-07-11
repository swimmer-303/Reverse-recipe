import type { Metadata, Viewport } from "next";
import { Newsreader, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Editorial display serif for the dish name and headings.
const display = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

// Highly legible grotesque for body copy and UI.
const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4ebdc" },
    { media: "(prefers-color-scheme: dark)", color: "#16100c" },
  ],
};

export const metadata: Metadata = {
  title: "Reverse Recipe — cook any meal from a photo",
  description:
    "Snap a photo of any meal and get the ingredients, calories, and a recipe to make it yourself.",
  openGraph: {
    title: "Reverse Recipe",
    description:
      "Snap a photo of any meal and get the ingredients, calories, and a recipe to make it yourself.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
