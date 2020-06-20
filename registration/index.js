const request = require('request-promise')

module.exports = async function (context, req) {

    if (req.body.object) {
        const svc = req.body.object
        const name = svc.metadata.name
        const namespace = svc.metadata.namespace

        context.log('Controller invoked with request', req.body)
        context.log('Controller invoked for service', name, namespace)

        const finalising = req.body.finalizing
        context.log('Is controller finalising', finalising)


        if (finalising) {
            context.log('Finalising....')
            await removeRecordFromGodaddy(context, name, namespace)
        } else {
            if (svc) {
                if (svc.spec.type == 'LoadBalancer') {
                    if (svc.status.loadBalancer) {
                        if (svc.status.loadBalancer.ingress) {
                            if (svc.status.loadBalancer.ingress.length > 0) {
                                const externalIP = svc.status.loadBalancer.ingress[0].ip
                                context.log('External IP', externalIP)
                                await addRecordToGodaddy(context, name, namespace, externalIP)
                            }
                        }
                    }
                }
            }
        }
    }

    context.res = {
        body: {},
        headers: {
            'Content-Type': 'application/json'
        }
    }
}

async function addRecordToGodaddy(context, name, namespace, ip) {
    const domain = process.env.DOMAIN
    const apiKey = process.env.GODADDY_API_KEY
    const apiSecret = process.env.GODADDY_API_SECRET

    const url = `https://api.godaddy.com/v1/domains/${domain}/records/A/${name}-${namespace}`

    try {
        context.log('Invoking godaddy PUT API', url)

        await request.put(url, {
            json: [
                {
                    data: ip
                }
            ],
            headers: {
                Authorization: `sso-key ${apiKey}:${apiSecret}`
            }
        }
        )
    } catch (e) {
        context.log('Error invoking PUT API', e)
    }

}

async function removeRecordFromGodaddy(context, name, namespace) {
    const domain = process.env.DOMAIN
    const apiKey = process.env.GODADDY_API_KEY
    const apiSecret = process.env.GODADDY_API_SECRET

    const url = `https://api.godaddy.com/v1/domains/${domain}/records/A`

    context.log('Trying to delete domain', `${name}-${namespace}`)

    try {
        // Fetch a list of domains
        context.log('Fetching all A records from GoDaddy', url)
        const listResponse = await request.get(url, {
            headers: {
                Authorization: `sso-key ${apiKey}:${apiSecret}`
            }
        })

        const filteredList = JSON.parse(listResponse).filter(
            record =>
                record.name != `${name}-${namespace}` &&
                record.data != 'Parked')

        // Replacing list of domains
        context.log('Replacing list of domains with', filteredList)

        await request.put(url, {
            json: filteredList,
            headers: {
                Authorization: `sso-key ${apiKey}:${apiSecret}`
            }
        })


    } catch (e) {
        context.log('Error deleting record', e)
    }
}