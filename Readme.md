# Serverless Kubernetes Controller for Godaddy Domain Registration

This is an example Kubernetes Controller that uses Metacontroller and Azure Functions. This controller registers all services of type **LoadBalancer** with Godaddy so that you have a DNS that you can use to access your service.

Envoy is used as a proxy to call the Azure function and injects the function key (secret) into the http call.

The first thing we need to do is to create a namespace for the metacontroller and deploy the RBAC rules.

```bash
kubectl create namespace metacontroller
kubectl apply -f ./metacontroller_rbac.yaml
```

Then we can create a function app in Azure and deploy the corresponding Azure function. When creating the function app we will need to set the following environment variables (DOMAIN, GODADDY_API_KEY, GODADDY_API_SECRET). The domain, key and secret can be obtained from Godaddy.

```bash
FUNCTION_APP_NAME="[Your App Name Here]"
func azure functionapp publish $FUNCTION_APP_NAME
```

Once you deploy the function you should get the URL and function key for the function.

```bash
FUNCTION_KEY="[Your function key]"
FUNCTION_URL="[Your function url]"
```

We will now create a secret from the sample envoy.yaml file in this repository. We first need to replace the values of the Function Key and Function URL

```bash
cat <<EOF > envoy_function_proxy.yaml
admin:
  access_log_path: /tmp/admin_access.log
  address:
    socket_address: { address: 0.0.0.0, port_value: 9901 }
static_resources:
  listeners:
    - name: listener_0
      address:
        socket_address: { address: 0.0.0.0, port_value: 10000 }
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              config:
                access_log:
                  - name: envoy.access_loggers.file
                    config:
                      path: "/dev/stdout"
                stat_prefix: ingress_http
                codec_type: AUTO
                route_config:
                  name: local_route
                  request_headers_to_add:
                    - header:
                        key: x-functions-key
                        value: $FUNCTION_KEY
                  virtual_hosts:
                    - name: godaddy-function
                      domains: ["*"]
                      routes:
                        - match:
                            prefix: "/godaddy"
                          route:
                            host_rewrite: $FUNCTION_URL
                            prefix_rewrite: "/api/registration"
                            cluster: godaddy-function
                http_filters:
                  - name: envoy.filters.http.router
  clusters:
    - name: godaddy-function
      connect_timeout: 60s
      type: LOGICAL_DNS
      dns_lookup_family: V4_ONLY
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: $FUNCTION_URL|443
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: $FUNCTION_URL
                      port_value: 443
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          sni: $FUNCTION_URL
EOF
```

We should now create the secret in kubernetes:

```bash
kubectl create secret generic envoy-config -n metacontroller --from-file="envoy.yaml=./envoy_function_proxy.yaml" 
```

We will now create the Metacontroller with the Sidecar

```bash
kubectl apply -f ./metacontroller.yaml
```

Finally we can get the Metacontroller to call our function by deploying a DecoratorController

```bash
kubectl apply -f ./k8s.yaml
```

Now to test the controller we deploy a sample nginx pod and create a service of type LoadBalancer. Once Azure allocates an external IP for the load balancer you should see the entry created in GoDaddy.

```bash
kubectl apply -f ./sample.yaml
```