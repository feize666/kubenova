FROM node:20-alpine AS builder
WORKDIR /app
ARG CONTROL_API_INTERNAL_BASE_URL=http://control-api:4000
ARG RUNTIME_GATEWAY_INTERNAL_BASE_URL=http://runtime-gateway:4100
ENV CONTROL_API_INTERNAL_BASE_URL=$CONTROL_API_INTERNAL_BASE_URL
ENV RUNTIME_GATEWAY_INTERNAL_BASE_URL=$RUNTIME_GATEWAY_INTERNAL_BASE_URL
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
