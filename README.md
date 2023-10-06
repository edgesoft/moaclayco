# Moa clay collection

## Images
To create images the following steps are nessesary. S3 images are cached thru the `twic.pics` service.

 - 1 Create a thumbnail image from the original image
 `convert -thumbnail 700x -quality 90 IMG_3720.HEIC 3720_thumb.jpg`

 - 2 Upload the image to an S3 bucket
 - 3 Update the MongoDB database with the twic.pics url.


## Development
The Dockerfile-development uses the same node version as in stage and production. Create and run the docker container with the image and run `npm install` to install the dependencies. Run `npm run dev` for development. Two ports needs to be opened to run in dev.

The following docker run command uses moaclayco as the image created from the `Dockerfile-development` docker file. 

`docker run -it -p 3000:3000 -p 3001:3001 -v /Users/developer/Desktop/moaclayco:/app moaclayco /bin/bash`


## Deployment
The `fly-prod.toml` and `Dockerfile-prod` is used for production. The github workflow is set up to build with these files when pused to the `master` branch. `fly-stage` and `Dockerfile-stage` is used for the stage environment. It should be pushed to the `next` branch. The stage fly application has the following url `https://moaclayco-dev.fly.dev/`. All code should be tested there before pushing to master. 

the `.env` file should contain the following keys.

 - MONGODB_URL `url to mongodb atlas`
 - EMAIL_PASSWORD `email password`
 - EMAIL_USERNAME `email username`
 - NODE_ENV `production` or `development`
 - STRIPE_PUBLIC_KEY `public key` to Stripe
 - STRIPE_SRV `server key` to Stripe
 - STRIPE_WEBHOOK `Webhook key` to Stripe
