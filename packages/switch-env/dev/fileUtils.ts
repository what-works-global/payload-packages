import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const getS3SignedUrl = async (path: string): Promise<string> => {
  const s3Client = new S3Client({
    region: requireEnv('S3_REGION'),
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
  })

  const commandParams = {
    Bucket: requireEnv('S3_BUCKET'),
    Key: path,
    Expires: 3600, // URL expires in 1 hour (adjust as needed)
  }
  const url = await getSignedUrl(s3Client, new GetObjectCommand(commandParams), { expiresIn: 3600 })
  return url
}
