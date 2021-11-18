FROM node:15-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache bash
RUN npm install -g pnpm

# Add config files
ADD package.json package.json
ADD pnpm-lock.yaml pnpm-lock.yaml
ADD tsconfig.json tsconfig.json
ADD vite.config.ts vite.config.ts

# Add source code
ADD client ./client
ADD shared ./shared
ADD server ./server

# Install dev and project dependencies
RUN pnpm i
RUN pnpm build

# Start
ENTRYPOINT ["pnpm", "start"]