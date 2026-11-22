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

# Start NestJS in watch mode for development
CMD ["npm", "run", "start:dev"]
