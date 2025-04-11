import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true // مهم جدًا عشان يشتغل على LAN
  }
});
