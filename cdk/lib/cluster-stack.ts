import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface EksProps extends cdk.StackProps {
  cluster: eks.Cluster
}

export class ClusterStack extends cdk.Stack {

  public readonly cluster: eks.Cluster;

  public readonly firstRegionRole: iam.Role;
  public readonly secondRegionRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const primaryRegion = 'ap-northeast-2';

    const clusterAdminRole = new iam.Role(this, 'AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });

    var eksClusterInstance = ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL);
    if (cdk.Stack.of(this).region != primaryRegion) {
      eksClusterInstance = ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.SMALL);
    }

    const eksCluster = new eks.Cluster(this, 'demogo-cluster', {
      clusterName: 'demogo',
      mastersRole: clusterAdminRole,
      version: eks.KubernetesVersion.V1_21,
      defaultCapacity: 2,
      defaultCapacityInstance: eksClusterInstance
    });

    eksCluster.addAutoScalingGroupCapacity('spot-group', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3A, ec2.InstanceSize.MEDIUM),
      spotPrice: cdk.Stack.of(this).region == primaryRegion ? '0.248' : '0.192'
    });

    this.cluster = eksCluster;

    if (cdk.Stack.of(this).region == primaryRegion) {
      this.firstRegionRole = createEKSClusterDeployRole(this, 'FirstRegionDeployRole');
      eksCluster.awsAuth.addMastersRole(this.firstRegionRole);
    } else {
      this.secondRegionRole = createEKSClusterDeployRole(this, 'SecondRegionDeployRole');
      eksCluster.awsAuth.addMastersRole(this.secondRegionRole); 
    }
  }
}

function createEKSClusterDeployRole(scope: Construct, id: string): iam.Role {

  const role = new iam.Role(scope, id, {
    roleName: cdk.PhysicalName.GENERATE_IF_NEEDED,
    assumedBy: new iam.AccountRootPrincipal()
  });
  return role;
}
