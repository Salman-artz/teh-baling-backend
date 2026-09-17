FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist

EXPOSE 3001
CMD ["node", "dist/index.js"]
