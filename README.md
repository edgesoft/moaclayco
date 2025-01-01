# Moa clay collection


## Development
The Dockerfile-development uses the same node version as in stage and production. Create and run the docker container with the image and run `npm install` to install the dependencies. Run `npm run dev` for development. Two ports needs to be opened to run in dev.

The following docker run command uses moaclayco as the image created from the `Dockerfile-development` docker file. 

`docker run -it -p 3000:3000 -p 3001:3001 -v /Users/developer/Desktop/moaclayco:/app moaclayco /bin/bash`

In domain.tsx you can set if sgwoods or moaclayco is the work in progress


## Deployment
The `fly-prod.toml` and `Dockerfile-prod` is used for production. The github workflow is set up to build with these files when pused to the `master` branch. `fly-stage` and `Dockerfile-stage` is used for the stage environment. It should be pushed to the `next` branch. The stage fly application has the following url `https://moaclayco-stage.fly.dev/`. All code should be tested there before pushing to master. 

the `.env` file should contain the following keys.

 - MONGODB_URL `url to mongodb atlas`
 - EMAIL_PASSWORD `email password`
 - EMAIL_USERNAME `email username`
 - NODE_ENV `production` or `development`
 - STRIPE_PUBLIC_KEY `public key` to Stripe
 - STRIPE_SRV `server key` to Stripe
 - STRIPE_WEBHOOK `Webhook key` to Stripe
 - MAGIC_LINK_SECRET `secret for mail`
 - AWS_ACCESS_KEY_ID
 - AWS_SECRET_ACCESS_KEY
 - AWS_REGION=eu-north-1
 - AWS_S3_BUCKET_NAME=moaclayco-stage
 - AWS_ITEM_PATH=items-stage
 - AWS_COLLECTION_PATH=collections-stage
 - AWS_VERIFICATIONS_PATH=verifications-stage
 - OPENAI_API_KEY
 - GOOGLE_CREDENTIALS_BASE64 `base 64 credential`
