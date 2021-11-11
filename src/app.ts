#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2';
import * as apigatewayv2_int from '@aws-cdk/aws-apigatewayv2-integrations';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as sfn_t from '@aws-cdk/aws-stepfunctions-tasks';
// @ts-ignore
import * as iam from '@aws-cdk/aws-iam';

export class SfnBugStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const httpApi = new apigatewayv2.HttpApi(this, 'Api');

    // The following API route forwards all requests to https://httpstat.us/*.
    // The step function (below) will construct the following url:
    // https://httpstat.us/200. This url responds with a simple HTTP/200
    // response that should cause the state machine execution to succeed.
    const httpRoute = new apigatewayv2.HttpRoute(this, 'ApiRoute', {
      httpApi,
      routeKey: apigatewayv2.HttpRouteKey.with('/{stuff+}'),
      integration: new apigatewayv2_int.HttpProxyIntegration({
        url: 'https://httpstat.us/{stuff}',
      }),
    });

    // Enable IAM authorization on the route.
    const cfnRoute = httpRoute.node.defaultChild as apigatewayv2.CfnRoute;
    cfnRoute.authorizationType = 'AWS_IAM';

    // Give a value to use for a dynamic api path component. In a less
    // contrived example, the dynamic value could be a resource id on a
    // rest api. e.g., /user/{userId}/something
    const mockExecutionInput = new sfn.Pass(this, 'Mock execution input', {
      parameters: {
        statusCode: '200',
      },
    });

    // Call the API with a dynamic apiPath
    const callApi = new sfn_t.CallApiGatewayHttpApiEndpoint(this, 'Call API Gateway', {
      apiStack: this,
      apiId: httpApi.apiId,
      method: sfn_t.HttpMethod.GET,
      authType: sfn_t.AuthType.IAM_ROLE,
      // Dynamic apiPath
      apiPath: sfn.JsonPath.stringAt(`States.Format('/{}', $.statusCode)`),
    });

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition: sfn.Chain.start(mockExecutionInput).next(callApi),
    });

    // Uncomment the following to work around `CallApiGatewayHttpApiEndpoint`'s
    // mangled IAM policy:

    // stateMachine.addToRolePolicy(
    //   new iam.PolicyStatement({
    //     effect: iam.Effect.ALLOW,
    //     resources: [this.getExecuteApiArn(httpApi)],
    //     actions: ['execute-api:Invoke'],
    //   }),
    // );

    // For reference, here is the mangled policy that is otherwise produced:
    // {
    //   "Version": "2012-10-17",
    //   "Statement": [
    //     {
    //       "Action": "execute-api:Invoke",
    //       "Resource": "arn:aws:execute-api:ca-central-1:111111111111:a111111111/undefined/GETStates.Format('/{}', $.statusCode)",
    //       "Effect": "Allow"
    //     }
    //   ]
    // }
    //
    // Problems:
    // - The API's stage is 'undefined' when it should be '$default'
    // - The api path is concatenated to the end of the resource without regard
    //   for the fact that we're using an intrinsic function - the path part
    //   after 'GET' should be '/*'


    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.url!,
    });

    new cdk.CfnOutput(this, 'StateMachineName', {
      value: stateMachine.stateMachineName,
    });
  }

  private getExecuteApiArn(httpApi: apigatewayv2.HttpApi) {
    return cdk.Fn.join('', [
      'arn:aws:execute-api:',
      this.region,
      ':',
      this.account,
      ':',
      httpApi.apiId,
      '/$default/GET/*',
    ]);
  }
}

const app = new cdk.App();
new SfnBugStack(app, 'SfnBugStack');
