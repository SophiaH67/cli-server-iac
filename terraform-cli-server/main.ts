import { Construct } from "constructs";
import { App, TerraformStack } from "cdktf";
import { DockerProvider } from "@cdktf/provider-docker/lib/provider";
import { Image } from "@cdktf/provider-docker/lib/image";
import { Container } from "@cdktf/provider-docker/lib/container";

class MyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new DockerProvider(this, "docker", {});

    const dockerImage = new Image(this, "cliServerImage", {
      name: "ghcr.io/nekoluka/cliserver:main",
      keepLocally: false,
    });

    new Container(this, "cliServerContainer", {
      name: "cliserver",
      image: dockerImage.name,
      volumes: [
        { containerPath: "/config.json", hostPath: `${process.cwd()}/config.json` },
      ],
      ports: [
        {
          internal: 8080,
          external: 8080,
        },
      ],
    });
  }
}

const app = new App();
new MyStack(app, "terraform-cli-server");
app.synth();
