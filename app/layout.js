import './globals.css';

export const metadata = {
  title: 'MediCore HIS — Healthcare Information System',
  description:
    'Centralised platform for patient records, appointments, medical histories, laboratory reports, prescriptions, billing and secure access to healthcare information.',
};

export const viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
};

/* Applies the saved theme (light/dark/system) before first paint so there is
   no flash of the wrong palette. Mirrors lib/theme.js — keep in sync. */
const themeBootstrap = `(function(){try{
var t=localStorage.getItem('his_theme');
var dark=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var e=document.documentElement;
e.setAttribute('data-theme',dark?'dark':'light');
e.style.colorScheme=dark?'dark':'light';
}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
