FROM node:22-alpine

WORKDIR /app

# Install dependencies needed for node-gyp or alpine if required
RUN apk add --no-cache libc6-compat

# Install dependencies based on package-lock.json
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Expose NestJS port
EXPOSE 3000

# Apply migrations (pgvector schema + indexes), then start in watch mode
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev"]
