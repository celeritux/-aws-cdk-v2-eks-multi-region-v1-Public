import * as cdk from 'aws-cdk-lib';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as pipelineAction from 'aws-cdk-lib/aws-codepipeline-actions';
import * as eks from 'aws-cdk-lib/aws-eks'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'
import { codeToECRspec, deployToEKSspec } from '../utils/buildspecs';

interface CiCdProps extends cdk.StackProps {
    accountId: String;

    firstRegionCluster: eks.Cluster;
    secondRegionCluster: eks.Cluster;

    firstRegionRole: iam.Role;
    secondRegionRole: iam.Role;
}

export class CicdStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props: CiCdProps) {
        super(scope, id, props);

        const primaryRegion = 'ap-northeast-2';
        const secondaryRegion = 'us-west-2';

        const helloPyRepo = new codecommit.Repository(this, 'hello-py-for-demogo', {
            repositoryName: `hello-py-${cdk.Stack.of(this).region}`
        });

        const ecrForMainRegion = new ecr.Repository(this, 'ecr-for-hello-py', {
            encryption: ecr.RepositoryEncryption.AES_256,
            imageScanOnPush: true
        });

        const buildForECR = codeToECRspec(this, ecrForMainRegion, props.accountId)
        ecrForMainRegion.grantPullPush(buildForECR.role!)

        const deployToMainCluster = deployToEKSspec(this, primaryRegion, props.firstRegionCluster, ecrForMainRegion, props.firstRegionRole);
        const deployTo2ndCluster = deployToEKSspec(this, secondaryRegion, props.secondRegionCluster, ecrForMainRegion, props.secondRegionRole);

        const sourceOutput = new codepipeline.Artifact()

        new codepipeline.Pipeline(this, 'multi-region-eks-dep', {
            stages: [{
                stageName: 'Source',
                actions: [new pipelineAction.CodeCommitSourceAction({
                    actionName: 'CatchSourceFromCode',
                    repository: helloPyRepo,
                    branch: "main",
                    output: sourceOutput
                })]
            }, {
                stageName: 'Build',
                actions: [new pipelineAction.CodeBuildAction({
                    actionName: 'BuildAndPushToECR',
                    input: sourceOutput,
                    project: buildForECR
                })]
            }, {
                stageName: 'DeployToMainEKSCluster',
                actions: [new pipelineAction.CodeBuildAction({
                    actionName: 'DeployToMainEKSCluster',
                    input: sourceOutput,
                    project: deployToMainCluster
                })]
            }, {
                stageName: 'ApproveToDeployTo2ndRegion',
                actions: [new pipelineAction.ManualApprovalAction({
                    actionName: 'ApproveToDeployTo2ndRegion'
                })]
            }, {
                stageName: 'DeployTo2ndRegionCluster',
                actions: [new pipelineAction.CodeBuildAction({
                    actionName: 'DeployTo2ndRegionCluster',
                    input: sourceOutput,
                    project: deployTo2ndCluster
                })]
            }]
        });

        new cdk.CfnOutput(this, 'codecommit-uri', {
            exportName: 'CodeCommitURL',
            value: helloPyRepo.repositoryCloneUrlHttp
        });
    }
}
