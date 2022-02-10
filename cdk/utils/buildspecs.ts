import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Construct } from 'constructs';


export function codeToECRspec(scope: Construct, apprepo: ecr.IRepository, accountId: String): codebuild.PipelineProject {

    const buildForECR = new codebuild.PipelineProject(scope, `build-to-ecr`, {
        projectName: `build-to-ecr`,
        environment: {
            buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
            privileged: true,
            computeType: codebuild.ComputeType.SMALL
        },
        environmentVariables: {
            'ECR_REPO_URI': {
                value: apprepo.repositoryUri
            },
            'ACCOUNT_ID': {
                value: accountId
            }
        },
        timeout: cdk.Duration.minutes(30),
        buildSpec: codebuild.BuildSpec.fromObject({
            version: "0.2",
            phases: {
                pre_build: {
                    commands: [
                        'env', 
                        `aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com`,
                        'IMAGE_TAG=$CODEBUILD_RESOLVED_SOURCE_VERSION'
                    ]
                },
                build: {
                    commands: [
                        'docker build -t $ECR_REPO_URI:latest .',
                        'docker tag $ECR_REPO_URI:latest $ECR_REPO_URI:$IMAGE_TAG'
                    ]
                },
                post_build: {
                    commands: [
                        'docker push $ECR_REPO_URI:latest',
                        'docker push $ECR_REPO_URI:$IMAGE_TAG'
                    ]
                }
            }
        })
    });

    return buildForECR;

}

export function deployToEKSspec(scope: Construct, region: string, cluster: eks.Cluster, apprepo: ecr.IRepository, roleToAssume: iam.Role): codebuild.PipelineProject {

    const deployBuildSpec = new codebuild.PipelineProject(scope, `deploy-to-eks-${region}`, {
        projectName: `deploy-to-eks-${region}`,
        environment: {
            buildImage: codebuild.LinuxBuildImage.fromAsset(scope, `custom-image-for-eks-${region}`, {
                directory: './utils/buildimage'
            })
        },
        environmentVariables: {
            'REGION': { value: region },
            'CLUSTER_NAME': { value: cluster.clusterName },
            'ECR_REPO_URI': { value: apprepo.repositoryUri },
        },
        buildSpec: codebuild.BuildSpec.fromObject({
            version: "0.2",
            phases: {
                install: {
                    commands: [
                        'env',
                        'export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}',
                        '/usr/local/bin/entrypoint.sh']
                },
                build: {
                    commands: [
                        `CREDENTIALS=$(aws sts assume-role --role-arn "${roleToAssume.roleArn}" --role-session-name codebuild-cdk)`,
                        'echo ${CREDENTIALS}',
                        `export AWS_ACCESS_KEY_ID="$(echo \${CREDENTIALS} | jq -r '.Credentials.AccessKeyId')"`,
                        `export AWS_SECRET_ACCESS_KEY="$(echo \${CREDENTIALS} | jq -r '.Credentials.SecretAccessKey')"`,
                        `export AWS_SESSION_TOKEN="$(echo \${CREDENTIALS} | jq -r '.Credentials.SessionToken')"`,
                        `export AWS_EXPIRATION=$(echo \${CREDENTIALS} | jq -r '.Credentials.Expiration')`,
                        `sed -i 's@CONTAINER_IMAGE@'"$ECR_REPO_URI:$TAG"'@' app-deployment.yaml`,
                        'cat app-deployment.yaml',
                        'kubectl apply -f app-deployment.yaml'
                    ]
                }
            }
        })
    });

    deployBuildSpec.addToRolePolicy(new iam.PolicyStatement({
        actions: ['eks:DescribeCluster'],
        resources: [`*`],
    }));

    deployBuildSpec.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [roleToAssume.roleArn]
    }))

    return deployBuildSpec;

}

