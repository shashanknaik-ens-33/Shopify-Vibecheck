
FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./

# Install development dependencies too, because the build uses them.
RUN npm ci --include=dev

COPY . .

# Generate Prisma Client and build the React Router app.
RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

# Run database migrations before starting the server.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
