import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as docker from "@pulumi/docker";
import * as random from "@pulumi/random";
import * as fs from "fs";

// Import the program's configuration settings.
const config = new pulumi.Config();
const imageName = config.get("imageName") || "my-app";
const appPath = config.get("appPath") || "../CliServer";
const containerPort = config.getNumber("containerPort") || 8080;
const cpu = config.getNumber("cpu") || 1;
const memory = config.get("memory") || "1Gi";
const concurrency = config.getNumber("concurrency") || 80;

// Import the provider's configuration settings.
const gcpConfig = new pulumi.Config("gcp");
const location = gcpConfig.require("region");
const project = gcpConfig.require("project");

// Generate a unique Artifact Registry repository ID
const uniqueString = new random.RandomString("unique-string", {
  length: 4,
  lower: true,
  upper: false,
  numeric: true,
  special: false,
});
let repoId = uniqueString.result.apply((result) => "repo-" + result);

// Create an Artifact Registry repository
const repository = new gcp.artifactregistry.Repository("repository", {
  description: "Repository for container image",
  format: "DOCKER",
  location: location,
  repositoryId: repoId,
});

// Form the repository URL
let repoUrl = pulumi.concat(
  location,
  "-docker.pkg.dev/",
  project,
  "/",
  repository.repositoryId
);

// Create a container image for the service.
// Before running `pulumi up`, configure Docker for authentication to Artifact Registry
// as described here: https://cloud.google.com/artifact-registry/docs/docker/authentication
const image = new docker.Image("image", {
  imageName: pulumi.concat(repoUrl, "/", imageName),
  build: {
    context: appPath,
    platform: "linux/amd64",
    args: {
      // Cloud Run currently requires x86_64 images
      // https://cloud.google.com/run/docs/container-contract#languages
      DOCKER_DEFAULT_PLATFORM: "linux/amd64",
    },
  },
});
// Import the config.json as a secret
const secret = new gcp.secretmanager.Secret("config", {
  secretId: "config",
  replication: {
    automatic: true,
  },
});

const secretVersion = new gcp.secretmanager.SecretVersion("config", {
  secret: secret.id,
  secretData: fs.readFileSync("./config.json").toString(),
});

const dockerServiceAccount = new gcp.serviceaccount.Account(
  "docker-service-account",
  {
    accountId: "docker-service-account",
    displayName: "Docker Service Account",
  }
);
// Grant the service account Secret Manager Secret Accessor permissions
const dockerServiceAccountSecretAccess = new gcp.secretmanager.SecretIamMember(
  "docker-service-account-secret-access",
  {
    member: pulumi.interpolate`serviceAccount:${dockerServiceAccount.email}`,
    secretId: secret.id,
    role: "roles/secretmanager.secretAccessor",
  }
);

// Create a Cloud Run service definition.
const service = new gcp.cloudrun.Service("service", {
  location,
  template: {
    spec: {
      serviceAccountName: dockerServiceAccount.email,
      volumes: [{ secret: { secretName: secret.secretId }, name: "config" }],
      containers: [
        {
          image: image.imageName,
          resources: {
            limits: {
              memory,
              cpu: cpu.toString(),
            },
          },
          volumeMounts: [
            {
              name: "config",
              mountPath: "/config",
            },
          ],
          commands: ["python", "cliserver.py", "/config/config"],
          ports: [
            {
              containerPort,
            },
          ],
        },
      ],
      containerConcurrency: concurrency,
    },
  },
});

// Create an IAM member to allow the service to be publicly accessible.
const invoker = new gcp.cloudrun.IamMember("invoker", {
  location,
  service: service.name,
  role: "roles/run.invoker",
  member: "allUsers",
});

// Export the URL of the service.
export const url = service.statuses.apply((statuses) => statuses[0]?.url);
