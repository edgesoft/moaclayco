import { FREE_FREIGHT, FREIGHT_COST } from '~/utils/constants'

const getFreightCost = (totalSum: number) => {
    return totalSum >= FREE_FREIGHT ? 0 : FREIGHT_COST
  }
  

  export default getFreightCost