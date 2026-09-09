FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_CONTROL_API_BASE=http://control-api:4000
ARG NEXT_PUBLIC_RUNTIME_GATEWAY_BASE=http://runtime-gateway:4100
ENV NEXT_PUBLIC_CONTROL_API_BASE=${NEXT_PUBLIC_CONTROL_API_BASE}
ENV NEXT_PUBLIC_RUNTIME_GATEWAY_BASE=${NEXT_PUBLIC_RUNTIME_GATEWAY_BASE}
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
