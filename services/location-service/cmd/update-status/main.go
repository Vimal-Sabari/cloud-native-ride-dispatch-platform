package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/location-service/internal/handler"
	dynamoclient "github.com/Vimal-Sabari/ride-dispatch-platform/shared/dynamo-client/go"
	models "github.com/Vimal-Sabari/ride-dispatch-platform/shared/models/go"
)

func hasAuthenticatedPrincipal(event events.APIGatewayProxyRequest) bool {
	if event.RequestContext.Authorizer != nil {
		if pid, ok := event.RequestContext.Authorizer["principalId"]; ok && pid != nil && pid != "" {
			return true
		}
		if sub, ok := event.RequestContext.Authorizer["sub"]; ok && sub != nil && sub != "" {
			return true
		}
	}
	if event.Headers != nil {
		if auth, ok := event.Headers["Authorization"]; ok && auth != "" {
			return true
		}
		if auth, ok := event.Headers["authorization"]; ok && auth != "" {
			return true
		}
	}
	return false
}

func newStatusHandler(writer handler.DynamoWriter) func(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return func(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
		if !hasAuthenticatedPrincipal(event) {
			bodyBytes, _ := json.Marshal(map[string]string{"error": "unauthorized"})
			return events.APIGatewayProxyResponse{
				StatusCode: 401,
				Headers:    map[string]string{"Content-Type": "application/json"},
				Body:       string(bodyBytes),
			}, nil
		}

		driverID := ""
		if event.PathParameters != nil {
			driverID = event.PathParameters["id"]
		}
		if driverID == "" {
			bodyBytes, _ := json.Marshal(map[string]string{"error": "missing driver id in path parameters"})
			return events.APIGatewayProxyResponse{
				StatusCode: 400,
				Headers:    map[string]string{"Content-Type": "application/json"},
				Body:       string(bodyBytes),
			}, nil
		}

		var req models.StatusUpdateRequest
		if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
			bodyBytes, _ := json.Marshal(map[string]string{"error": "invalid json request body"})
			return events.APIGatewayProxyResponse{
				StatusCode: 400,
				Headers:    map[string]string{"Content-Type": "application/json"},
				Body:       string(bodyBytes),
			}, nil
		}

		code, respBody, err := handler.HandleUpdateStatus(ctx, driverID, req, writer)
		if err != nil {
			log.Printf("Error updating status: %v", err)
			return events.APIGatewayProxyResponse{
				StatusCode: 500,
				Headers:    map[string]string{"Content-Type": "application/json"},
				Body:       fmt.Sprintf(`{"message": "Internal server error", "error": "%v"}`, err),
			}, nil
		}

		respBytes, _ := json.Marshal(respBody)

		return events.APIGatewayProxyResponse{
			StatusCode: code,
			Headers:    map[string]string{"Content-Type": "application/json"},
			Body:       string(respBytes),
		}, nil
	}
}

func getClientFromEnv(ctx context.Context) (*dynamoclient.Client, error) {
	tableName := os.Getenv("DYNAMODB_TABLE")
	if tableName == "" {
		tableName = os.Getenv("DYNAMO_TABLE_NAME")
	}
	if tableName == "" {
		tableName = os.Getenv("TABLE_NAME")
	}
	if tableName == "" {
		tableName = "ride-dispatch-table"
	}

	endpoint := os.Getenv("AWS_ENDPOINT_URL")
	if endpoint == "" {
		endpoint = os.Getenv("LOCALSTACK_ENDPOINT")
	}
	if endpoint == "" {
		endpoint = os.Getenv("DYNAMO_ENDPOINT")
	}

	// LocalStack container resolution: when running inside a Lambda container in LocalStack Docker network,
	// localhost is unreachable. Instead, use the injected AWS_ENDPOINT_URL or LOCALSTACK_HOSTNAME or default to localstack.
	if strings.Contains(endpoint, "localhost") || endpoint == "" {
		if localstackHost := os.Getenv("LOCALSTACK_HOSTNAME"); localstackHost != "" {
			endpoint = fmt.Sprintf("http://%s:4566", localstackHost)
		} else if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
			endpoint = "http://localstack:4566"
		}
	}

	return dynamoclient.NewClient(ctx, tableName, endpoint)
}

func main() {
	ctx := context.Background()
	client, err := getClientFromEnv(ctx)
	if err != nil {
		log.Fatalf("failed to initialize DynamoDB client: %v", err)
	}

	lambda.Start(newStatusHandler(client))
}
