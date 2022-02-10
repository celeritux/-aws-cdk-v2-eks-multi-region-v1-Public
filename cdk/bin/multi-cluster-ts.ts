#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClusterStack } from '../lib/cluster-stack';
import { ContainerStack } from '../lib/container-stack';
import { CicdStack } from '../lib/cicd-stack';

const app = new cdk.App();

const account = app.node.tryGetContext('account') || process.env.CDK_INTEG_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;

// Primary Region
const primaryRegion = {account: account, region: 'ap-northeast-2'};
const primaryCluster = new ClusterStack(app, `ClusterStack-${primaryRegion.region}`, {
    env: primaryRegion
})
new ContainerStack(app, `ContainerStack-${primaryRegion.region}`, {
    env: primaryRegion,
    cluster: primaryCluster.cluster
})

// Secondary Region
const secondaryRegion = {account: account, region: 'us-west-2'};
const secondaryCluster = new ClusterStack(app, `ClusterStack-${secondaryRegion.region}`, {
    env: secondaryRegion
})
new ContainerStack(app, `ContainerStack-${secondaryRegion.region}`, {
    env: secondaryRegion,
    cluster: secondaryCluster.cluster
})

// Build and Deploy Pipeline
new CicdStack(app, 'CiCdStack', {
    env: primaryRegion,
    accountId: account,
    firstRegionCluster: primaryCluster.cluster,
    secondRegionCluster: secondaryCluster.cluster,
    firstRegionRole: primaryCluster.firstRegionRole,
    secondRegionRole: secondaryCluster.secondRegionRole
})




